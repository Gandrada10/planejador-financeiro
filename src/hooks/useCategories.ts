import { useState, useEffect } from 'react';
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

function docToCategory(id: string, data: Record<string, unknown>): Category {
  return {
    id,
    name: (data.name as string) || '',
    icon: (data.icon as string) || '',
    color: (data.color as string) || '#f59e0b',
    type: (data.type as Category['type']) || 'despesa',
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

function docToRule(id: string, data: Record<string, unknown>): CategoryRule {
  return {
    id,
    pattern: (data.pattern as string) || '',
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
      setCategories(snap.docs.map((d) => docToCategory(d.id, d.data())));
      setLoading(false);
    });

    const unsub2 = onSnapshot(query(rulesRef, orderBy('pattern')), (snap) => {
      setRules(snap.docs.map((d) => docToRule(d.id, d.data())));
    });

    return () => { unsub1(); unsub2(); };
  }, []);

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

  async function deleteRule(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'categoryRules', id));
  }

  // Match a description against rules and return category ID
  function matchCategory(description: string): string | null {
    const lower = description.toLowerCase();
    for (const rule of rules) {
      const pattern = rule.pattern.toLowerCase();
      // Support wildcards: *uber* matches "UBER TRIP 123"
      if (pattern.startsWith('*') && pattern.endsWith('*')) {
        if (lower.includes(pattern.slice(1, -1))) return rule.categoryId;
      } else if (pattern.startsWith('*')) {
        if (lower.endsWith(pattern.slice(1))) return rule.categoryId;
      } else if (pattern.endsWith('*')) {
        if (lower.startsWith(pattern.slice(0, -1))) return rule.categoryId;
      } else {
        if (lower.includes(pattern)) return rule.categoryId;
      }
    }
    return null;
  }

  return { categories, rules, loading, addCategory, updateCategory, deleteCategory, addRule, deleteRule, matchCategory };
}
