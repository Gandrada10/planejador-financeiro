#!/usr/bin/env python3
"""Restaura no Firestore os documentos de um backup que NAO existem mais la.

Cirurgico e estritamente ADITIVO: documentos presentes no Firestore nunca sao
tocados (nem sobrescritos, nem apagados) — so recria os ausentes, a partir do
backup exportado pelo app. Grava um log JSON com os ids restaurados por
colecao, para que a operacao seja reversivel.

Uso:
  python restore_missing.py --backup <arquivo.json>            # simulacao (dry-run)
  python restore_missing.py --backup <arquivo.json> --execute  # grava de verdade
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CREDENTIALS = SCRIPT_DIR / "serviceAccountKey.json"

# Todas as colecoes que o backup do app cobre (src/lib/backup.ts).
USER_COLLECTIONS = (
    "transactions", "categories", "categoryRules", "accounts", "familyMembers",
    "titularMappings", "billingCycles", "projects", "budgets",
)

TIMESTAMP_MARKER = "__firestoreTimestamp__"
BATCH_LIMIT = 450  # limite do Firestore e 500 ops/batch


def revive(value):
    """Reconstroi datetimes do formato do backup, preservando nanos ~ micros."""
    if isinstance(value, dict):
        if value.get(TIMESTAMP_MARKER) is True:
            seconds = value.get("seconds") or 0
            nanos = value.get("nanoseconds") or 0
            return datetime.fromtimestamp(seconds, tz=timezone.utc) + timedelta(
                microseconds=nanos / 1000
            )
        return {k: revive(v) for k, v in value.items()}
    if isinstance(value, list):
        return [revive(v) for v in value]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--execute", action="store_true",
                        help="sem esta flag, apenas simula e mostra contagens")
    args = parser.parse_args()

    raw = json.loads(args.backup.read_text(encoding="utf-8"))
    uid = raw.get("userId")
    if not uid:
        sys.exit("Backup sem userId.")

    firebase_admin.initialize_app(credentials.Certificate(str(args.credentials)))
    db = firestore.client()

    plan = {}
    for name in USER_COLLECTIONS:
        col = db.collection("users").document(uid).collection(name)
        existing = {ref.id for ref in col.list_documents()}
        backup_docs = raw.get("collections", {}).get(name, [])
        missing = [item for item in backup_docs if item.get("id") not in existing]
        plan[name] = {"existing": len(existing), "backup": len(backup_docs), "missing": missing}
        print(
            f"{name:18s} no Firestore: {len(existing):5d} | no backup: {len(backup_docs):5d} "
            f"| a restaurar: {len(missing):5d}"
        )

    total = sum(len(p["missing"]) for p in plan.values())
    if not args.execute:
        print(f"\nDRY-RUN: {total} documentos seriam restaurados. Rode com --execute para gravar.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = SCRIPT_DIR / f"restore-log-{stamp}.json"
    log = {"backup": args.backup.name, "uid": uid, "restored": {}}

    for name, p in plan.items():
        ids = []
        items = p["missing"]
        for i in range(0, len(items), BATCH_LIMIT):
            batch = db.batch()
            for item in items[i : i + BATCH_LIMIT]:
                ref = db.collection("users").document(uid).collection(name).document(item["id"])
                batch.set(ref, revive(item.get("data") or {}))
                ids.append(item["id"])
            batch.commit()
        log["restored"][name] = ids
        if ids:
            print(f"{name}: {len(ids)} restaurados")

    log_path.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nConcluido: {total} documentos restaurados. Log reversivel em: {log_path}")


if __name__ == "__main__":
    main()
