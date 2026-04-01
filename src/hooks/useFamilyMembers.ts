import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { FamilyMember } from '../types';

function docToMember(id: string, data: Record<string, unknown>): FamilyMember {
  return {
    id,
    name: (data.name as string) || '',
    color: (data.color as string) || '#888888',
  };
}

export function useFamilyMembers() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const ref = collection(db, 'users', uid, 'familyMembers');
    return onSnapshot(query(ref, orderBy('name')), (snap) => {
      setMembers(snap.docs.map((d) => docToMember(d.id, d.data())));
      setLoading(false);
    });
  }, []);

  async function addMember(name: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'familyMembers'), {
      name: name.trim(),
      color: '#888888',
      createdAt: Timestamp.now(),
    });
  }

  async function deleteMember(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'familyMembers', id));
  }

  const memberNames = members.map((m) => m.name);

  return { members, memberNames, loading, addMember, deleteMember };
}
