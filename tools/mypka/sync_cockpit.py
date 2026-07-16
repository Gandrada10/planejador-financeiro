#!/usr/bin/env python3
"""Espelha os dados financeiros do planejador para o SQLite do cockpit myPKA.

Duas fontes possíveis (one-way, escrita atômica no SQLite):
  A) Firestore ao vivo (Admin SDK):  --uid <UID>  [--credentials chave.json]
  B) Arquivo de backup do app (Configurações -> Backup):  --backup arquivo.json

O cockpit abre esse banco em modo read-only; este script é o ÚNICO escritor.
A escrita é feita num arquivo temporário e trocada com os.replace (atômico),
então o cockpit nunca lê um espelho pela metade.

Uso:
  python sync_cockpit.py --backup <backup.json>   # fonte: backup exportado
  python sync_cockpit.py --list-users             # descobre o uid da conta
  python sync_cockpit.py --uid <UID>              # fonte: Firestore ao vivo
  python sync_cockpit.py ... --db <caminho/para/mypka-financas.db>

O modo Firestore exige `pip install firebase-admin` + serviceAccountKey.json
nesta pasta (gitignored). O modo backup não exige nada.
"""

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
# planejador-financeiro/tools/mypka -> raiz do myPKA (ao lado do mypka.db)
DEFAULT_DB = SCRIPT_DIR.parents[2] / "mypka-financas.db"
DEFAULT_CREDENTIALS = SCRIPT_DIR / "serviceAccountKey.json"

COLLECTIONS = (
    "transactions",
    "categories",
    "accounts",
    "budgets",
    "billingCycles",
    "projects",
)

SCHEMA = """
CREATE TABLE fin_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE fin_categories (
  id                  TEXT PRIMARY KEY,
  name                TEXT,
  icon                TEXT,
  color               TEXT,
  type                TEXT,             -- 'receita' | 'despesa' | 'ambos'
  parent_id           TEXT,
  exclude_from_totals INTEGER DEFAULT 0 -- ex.: Transferencia (pagto de fatura, PIX interno)
);

CREATE TABLE fin_accounts (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  type         TEXT,                    -- 'corrente'|'cartao'|'beneficio'|'poupanca'|'investimento'|'outro'
  bank         TEXT,
  closing_day  INTEGER,
  due_day      INTEGER,
  credit_limit REAL
);

CREATE TABLE fin_transactions (
  id                  TEXT PRIMARY KEY,
  date                TEXT,             -- ISO YYYY-MM-DD (data de caixa)
  purchase_date       TEXT,
  description         TEXT,
  amount              REAL,             -- ASSINADO: receita > 0, despesa < 0
  category_id         TEXT,
  account             TEXT,
  family_member       TEXT,
  titular             TEXT,
  installment_number  INTEGER,
  total_installments  INTEGER,
  card_number         TEXT,
  project_id          TEXT,
  tags                TEXT,             -- JSON array
  notes               TEXT,
  billing_month       TEXT,             -- 'YYYY-MM' da fatura (cartao); mes fiscal do lancamento
  provisional_date    TEXT,
  fitid               TEXT,
  reconciled          INTEGER,
  import_batch        TEXT,
  raw_json            TEXT              -- documento Firestore completo (a prova de futuro)
);
CREATE INDEX idx_fin_tx_date     ON fin_transactions (date);
CREATE INDEX idx_fin_tx_category ON fin_transactions (category_id);
CREATE INDEX idx_fin_tx_billing  ON fin_transactions (billing_month);

CREATE TABLE fin_budgets (
  id           TEXT PRIMARY KEY,
  category_id  TEXT,
  month_year   TEXT,                    -- 'YYYY-MM'
  limit_amount REAL
);

CREATE TABLE fin_billing_cycles (
  id           TEXT PRIMARY KEY,
  account_id   TEXT,
  month_year   TEXT,
  status       TEXT,                    -- 'open' | 'closed'
  closed_at    TEXT,
  paid_amount  REAL,
  payment_date TEXT
);

CREATE TABLE fin_projects (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  color      TEXT,
  status     TEXT,
  start_date TEXT,
  end_date   TEXT
);

-- Convencao central do app (src/lib/utils.ts countsInTotals): transacao conta
-- nos totais a menos que sua categoria tenha exclude_from_totals. Sem categoria
-- SEMPRE conta. Toda agregacao parte desta view, nunca da tabela crua.
CREATE VIEW v_fin_counted AS
SELECT t.*, COALESCE(c.parent_id, t.category_id) AS root_category_id
FROM fin_transactions t
LEFT JOIN fin_categories c ON c.id = t.category_id
WHERE t.category_id IS NULL OR COALESCE(c.exclude_from_totals, 0) = 0;

-- Mes efetivo do lancamento: billing_month (fatura do cartao) quando preenchido,
-- senao o mes da data de caixa. Alinha com a constante EFF_MONTH do financeApi.js
-- (o backend agrega sempre por esse mes). billing_month e' NULL/'' na maioria das
-- linhas hoje, entao o COALESCE nao altera os totais atuais.
CREATE VIEW v_fin_monthly AS
SELECT COALESCE(NULLIF(billing_month, ''), substr(date, 1, 7)) AS month,
       SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS receitas,
       SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS despesas,
       SUM(amount)                                      AS resultado,
       COUNT(*)                                         AS lancamentos
FROM v_fin_counted
GROUP BY month;

CREATE VIEW v_fin_category_month AS
SELECT substr(t.month, 1, 7) AS month, t.root_category_id,
       COALESCE(r.name, 'Sem categoria') AS category_name,
       t.total, t.lancamentos
FROM (
  SELECT COALESCE(NULLIF(billing_month, ''), substr(date, 1, 7)) AS month, root_category_id,
         SUM(amount) AS total, COUNT(*) AS lancamentos
  FROM v_fin_counted
  GROUP BY month, root_category_id
) t
LEFT JOIN fin_categories r ON r.id = t.root_category_id;
"""


def init_firebase(credentials_path):
    try:
        import firebase_admin
        from firebase_admin import auth, credentials, firestore
    except ImportError:
        sys.exit(
            "firebase-admin nao instalado (necessario so no modo Firestore).\n"
            "  pip install firebase-admin\n"
            "Ou use o modo backup: --backup <arquivo exportado pelo app>."
        )
    if not credentials_path.exists():
        sys.exit(
            f"Credencial nao encontrada: {credentials_path}\n"
            "Gere a chave no console do Firebase (Configuracoes do projeto ->\n"
            "Contas de servico -> Gerar nova chave privada) e salve nesse caminho.\n"
            "Ou use o modo backup: --backup <arquivo exportado pelo app>."
        )
    firebase_admin.initialize_app(credentials.Certificate(str(credentials_path)))
    return auth, firestore


# Marcador usado por src/lib/backup.ts para serializar Timestamps no JSON.
TIMESTAMP_MARKER = "__firestoreTimestamp__"


def revive(value):
    """Reconstroi datetimes a partir do formato do backup (recursivo)."""
    if isinstance(value, dict):
        if value.get(TIMESTAMP_MARKER) is True:
            return datetime.fromtimestamp(value.get("seconds") or 0, tz=timezone.utc)
        return {k: revive(v) for k, v in value.items()}
    if isinstance(value, list):
        return [revive(v) for v in value]
    return value


def load_backup(path):
    """Le um BackupFile (formatVersion 1) e devolve (data, uid, exported_at)."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    version = raw.get("formatVersion")
    if not isinstance(version, int) or version > 1:
        sys.exit(f"Backup com formatVersion nao suportado: {version!r}")
    cols = raw.get("collections") or {}
    data = {}
    for name in COLLECTIONS:
        docs = []
        for item in cols.get(name, []):
            d = revive(item.get("data") or {})
            d["__id"] = item.get("id")
            docs.append(d)
        data[name] = docs
    return data, raw.get("userId") or "(backup)", raw.get("exportedAt")


def iso_date(value):
    """Normaliza data do Firestore (Timestamp/datetime ou string) para ISO."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value)
    return text[:10] if len(text) >= 10 else text


def iso_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def fetch_collection(db, uid, name):
    docs = []
    for snap in db.collection("users").document(uid).collection(name).stream():
        data = snap.to_dict() or {}
        data["__id"] = snap.id
        docs.append(data)
    return docs


def build_mirror(tmp_path, uid, data, source="firestore", data_as_of=None):
    conn = sqlite3.connect(tmp_path)
    try:
        conn.executescript(SCHEMA)

        conn.executemany(
            "INSERT INTO fin_categories VALUES (?,?,?,?,?,?,?)",
            [
                (
                    d["__id"], d.get("name"), d.get("icon"), d.get("color"),
                    d.get("type"), d.get("parentId"),
                    1 if d.get("excludeFromTotals") else 0,
                )
                for d in data["categories"]
            ],
        )
        conn.executemany(
            "INSERT INTO fin_accounts VALUES (?,?,?,?,?,?,?)",
            [
                (
                    d["__id"], d.get("name"), d.get("type"), d.get("bank"),
                    d.get("closingDay"), d.get("dueDay"), d.get("creditLimit"),
                )
                for d in data["accounts"]
            ],
        )
        conn.executemany(
            "INSERT INTO fin_transactions VALUES "
            "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    d["__id"], iso_date(d.get("date")), iso_date(d.get("purchaseDate")),
                    d.get("description"), d.get("amount"), d.get("categoryId"),
                    d.get("account"), d.get("familyMember"), d.get("titular"),
                    d.get("installmentNumber"), d.get("totalInstallments"),
                    d.get("cardNumber"), d.get("projectId"),
                    json.dumps(d.get("tags"), ensure_ascii=False) if d.get("tags") else None,
                    d.get("notes"), d.get("billingMonth"),
                    iso_date(d.get("provisionalDate")), d.get("fitid"),
                    1 if d.get("reconciled") else 0, d.get("importBatch"),
                    json.dumps(d, ensure_ascii=False, default=json_default),
                )
                for d in data["transactions"]
            ],
        )
        conn.executemany(
            "INSERT INTO fin_budgets VALUES (?,?,?,?)",
            [
                (d["__id"], d.get("categoryId"), d.get("monthYear"), d.get("limitAmount"))
                for d in data["budgets"]
            ],
        )
        conn.executemany(
            "INSERT INTO fin_billing_cycles VALUES (?,?,?,?,?,?,?)",
            [
                (
                    d["__id"], d.get("accountId"), d.get("monthYear"), d.get("status"),
                    iso_datetime(d.get("closedAt")), d.get("paidAmount"),
                    iso_date(d.get("paymentDate")),
                )
                for d in data["billingCycles"]
            ],
        )
        conn.executemany(
            "INSERT INTO fin_projects VALUES (?,?,?,?,?,?)",
            [
                (
                    d["__id"], d.get("name"), d.get("color"), d.get("status"),
                    iso_date(d.get("startDate")), iso_date(d.get("endDate")),
                )
                for d in data["projects"]
            ],
        )

        meta = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "uid": uid,
            "source": source,
            "data_as_of": data_as_of or datetime.now(timezone.utc).isoformat(),
        }
        meta.update({f"count_{k}": str(len(v)) for k, v in data.items()})
        conn.executemany("INSERT INTO fin_meta VALUES (?,?)", sorted(meta.items()))

        conn.commit()
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uid", help="uid do usuario no Firebase Auth")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB,
                        help=f"destino do espelho SQLite (default: {DEFAULT_DB})")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS,
                        help="caminho do serviceAccountKey.json (modo Firestore)")
    parser.add_argument("--backup", type=Path,
                        help="arquivo de backup exportado pelo app (modo offline)")
    parser.add_argument("--list-users", action="store_true",
                        help="lista uid/email das contas e sai (modo Firestore)")
    args = parser.parse_args()

    if args.backup:
        if not args.backup.exists():
            sys.exit(f"Backup nao encontrado: {args.backup}")
        data, uid, data_as_of = load_backup(args.backup)
        source = f"backup:{args.backup.name}"
    else:
        auth, firestore = init_firebase(args.credentials)

        if args.list_users:
            for user in auth.list_users().iterate_all():
                print(f"{user.uid}  {user.email or '(sem email)'}")
            return

        uid = args.uid
        if not uid:
            # Zero-config: com uma única conta no projeto, usa-a direto.
            users = list(auth.list_users().iterate_all())
            if len(users) == 1:
                uid = users[0].uid
            else:
                listing = "\n".join(f"  {u.uid}  {u.email or '(sem email)'}" for u in users)
                sys.exit(
                    "Mais de uma conta no projeto — informe --uid:\n" + listing
                )

        db = firestore.client()
        data = {name: fetch_collection(db, uid, name) for name in COLLECTIONS}
        source, data_as_of = "firestore", None

    if not data["transactions"]:
        sys.exit(
            "Nenhuma transacao encontrada — abortando sem tocar no espelho "
            "existente. Confira o uid (--list-users) ou o arquivo de backup."
        )

    args.db.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=".db", dir=str(args.db.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        tmp_path.unlink()  # sqlite cria o arquivo do zero
        build_mirror(str(tmp_path), uid, data, source=source, data_as_of=data_as_of)
        os.replace(str(tmp_path), str(args.db))
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    counts = ", ".join(f"{k}={len(v)}" for k, v in data.items())
    print(f"Espelho atualizado: {args.db}\n{counts}")


if __name__ == "__main__":
    main()
