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
import type { Project } from '../types';

function docToProject(id: string, data: Record<string, unknown>): Project {
  return {
    id,
    name: (data.name as string) || '',
    color: (data.color as string) || '#f59e0b',
    status: (data.status as Project['status']) || 'active',
    createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
  };
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, 'users', uid, 'projects');
    const unsub = onSnapshot(query(ref, orderBy('name')), (snap) => {
      setProjects(snap.docs.map((d) => docToProject(d.id, d.data())));
      setLoading(false);
    });
    return unsub;
  }, []);

  const activeProjects = projects.filter((p) => p.status === 'active');

  async function addProject(data: Omit<Project, 'id' | 'createdAt'>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'projects'), {
      ...data,
      createdAt: Timestamp.now(),
    });
  }

  async function updateProject(id: string, data: Partial<Project>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const updates = { ...data };
    delete updates.id;
    delete updates.createdAt;
    await updateDoc(doc(db, 'users', uid, 'projects', id), updates);
  }

  async function deleteProject(id: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'projects', id));
  }

  return { projects, activeProjects, loading, addProject, updateProject, deleteProject };
}
