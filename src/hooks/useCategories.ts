import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Category, CategoryRule } from '../types';
import { ICON_MAP, suggestIconForCategory, SEED_CATEGORIES } from '../components/shared/CategoryIcon';

function docToCategory(id: string, data: Record<string, unknown>): Category {
  return {
    id,
    name: (data.name as string) || '',
    icon: (data.icon as string) || '',
    color: (data.color as string) || '#f59e0b',
    type: (data.type as Category['type']) || 'despesa',
    parentId: (data.parentId as string | null) ?? null,
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

function docToRule(id: string, data: Record<string, unknown>): CategoryRule {
  return {
    id,
    pattern: (data.pattern as string) || '',
    keywords: Array.isArray(data.keywords) ? (data.keywords as string[]) : [],
    categoryId: (data.categoryId as string) || '',
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const catRef = collection(db, 'users', uid, 'categories');
    const rulesRef = collection(db, 'users', uid, 'categoryRules');

    const unsub1 = onSnapshot(query(catRef, orderBy('name')), (snap) => {
      const cats = snap.docs.map((d) => docToCategory(d.id, d.data()));
      setCategories(cats);
      setLoading(false);
    });

    const unsub2 = onSnapshot(query(rulesRef, orderBy('pattern')), (snap) => {
      setRules(snap.docs.map((d) => docToRule(d.id, d.data())));
    });

    return () => { unsub1(); unsub2(); };
  }, []);

  // Auto-migrate emoji icons to Lucide icon keys (runs once)
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || loading || categories.length === 0) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const toMigrate = categories.filter((c) => !ICON_MAP[c.icon]);
    if (toMigrate.length === 0) { migrated.current = true; return; }
    migrated.current = true;
    for (const cat of toMigrate) {
      const suggested = suggestIconForCategory(cat.name);
      updateDoc(doc(db, 'users', uid, 'categories', cat.id), { icon: suggested });
    }
  }, [loading, categories]);

  async function addCategory(data: Omit<Category, 'id' | 'createdAt'>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'categories'), {
      ...data,
      createdAt: Timestamp.now(),
    });
  }

  async function updateCategory(id: string, data: Partial<Category>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const updates = { ...data };
    delete updates.id;
    delete updates.createdAt;
    await updateDoc(doc(db, 'users', uid, 'categories', id), updates);
  }

  async function deleteCategory(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'categories', id));
  }

  async function addRule(data: Omit<CategoryRule, 'id' | 'createdAt'>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'categoryRules'), {
      ...data,
      createdAt: Timestamp.now(),
    });
  }

  async function updateRule(id: string, data: Partial<CategoryRule>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const updates = { ...data };
    delete updates.id;
    delete updates.createdAt;
    await updateDoc(doc(db, 'users', uid, 'categoryRules', id), updates);
  }

  async function deleteRule(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'categoryRules', id));
  }

  // Use a ref so matchCategory always sees the latest rules without re-creating
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // Check if a single pattern matches a description (wildcard support)
  function patternMatches(lower: string, rawPattern: string): boolean {
    const pattern = rawPattern.toLowerCase();
    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      return lower.includes(pattern.slice(1, -1));
    } else if (pattern.startsWith('*')) {
      return lower.endsWith(pattern.slice(1));
    } else if (pattern.endsWith('*')) {
      return lower.startsWith(pattern.slice(0, -1));
    } else {
      return lower.includes(pattern);
    }
  }

  // Match a description against rules (pattern + keywords) and return category ID
  const matchCategory = useCallback((description: string): string | null => {
    const lower = description.toLowerCase();
    for (const rule of rulesRef.current) {
      if (patternMatches(lower, rule.pattern)) return rule.categoryId;
      if (rule.keywords?.length) {
        for (const kw of rule.keywords) {
          if (kw && patternMatches(lower, kw)) return rule.categoryId;
        }
      }
    }
    return null;
  }, []);

  // Root categories (no parent)
  const rootCategories = categories.filter((c) => !c.parentId);
  // Subcategories of a given parent
  function subCategories(parentId: string) {
    return categories.filter((c) => c.parentId === parentId);
  }
  // Flat ordered list: parent first, then its children (indented in UI)
  const categoriesOrdered: (Category & { depth: number })[] = [];
  for (const root of rootCategories) {
    categoriesOrdered.push({ ...root, depth: 0 });
    for (const sub of subCategories(root.id)) {
      categoriesOrdered.push({ ...sub, depth: 1 });
    }
  }

  // Sync categories with the desired seed data (add missing, update icons)
  async function syncCategories() {
    const uid = auth.currentUser?.uid;
    if (!uid) return { added: 0, updated: 0 };

    const normalize = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let added = 0;
    let updated = 0;

    for (const seed of SEED_CATEGORIES) {
      // Find or create the root category
      let root = categories.find((c) => !c.parentId && normalize(c.name) === normalize(seed.name));

      if (!root) {
        const ref = await addDoc(collection(db, 'users', uid, 'categories'), {
          name: seed.name,
          icon: seed.icon,
          color: '#f59e0b',
          type: seed.type,
          parentId: null,
          createdAt: Timestamp.now(),
        });
        root = { id: ref.id, name: seed.name, icon: seed.icon, color: '#f59e0b', type: seed.type, parentId: null, createdAt: new Date() };
        added++;
      } else if (root.icon !== seed.icon) {
        await updateDoc(doc(db, 'users', uid, 'categories', root.id), { icon: seed.icon });
        updated++;
      }

      // Find or create subcategories
      for (const sub of seed.subs) {
        const existing = categories.find(
          (c) => c.parentId === root!.id && normalize(c.name) === normalize(sub.name)
        );
        if (!existing) {
          await addDoc(collection(db, 'users', uid, 'categories'), {
            name: sub.name,
            icon: sub.icon,
            color: '#f59e0b',
            type: seed.type,
            parentId: root.id,
            createdAt: Timestamp.now(),
          });
          added++;
        } else if (existing.icon !== sub.icon) {
          await updateDoc(doc(db, 'users', uid, 'categories', existing.id), { icon: sub.icon });
          updated++;
        }
      }
    }

    return { added, updated };
  }

  return { categories, categoriesOrdered, rootCategories, subCategories, rules, loading, addCategory, updateCategory, deleteCategory, addRule, updateRule, deleteRule, matchCategory, syncCategories };
}
