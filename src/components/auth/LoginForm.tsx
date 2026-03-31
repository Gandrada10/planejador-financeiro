import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { LogIn, UserPlus, Globe } from 'lucide-react';

export function LoginForm() {
  const { login, register, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password);
      } else {
        await login(email, password);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao autenticar');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError('');
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao autenticar com Google');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary">
      <div className="w-full max-w-md p-8 bg-bg-card border border-border rounded-lg">
        <h1 className="text-2xl font-bold text-accent mb-2 text-center">
          PLANEJADOR FINANCEIRO
        </h1>
        <p className="text-text-secondary text-sm text-center mb-8">
          Controle financeiro familiar
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1 uppercase tracking-wider">
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
              required
              minLength={6}
            />
          </div>

          {error && (
            <p className="text-accent-red text-xs">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRegister ? <UserPlus size={16} /> : <LogIn size={16} />}
            {loading ? '...' : isRegister ? 'Criar conta' : 'Entrar'}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-text-secondary">ou</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <button
          onClick={handleGoogle}
          className="w-full py-2 bg-bg-secondary border border-border text-text-primary text-sm rounded hover:border-accent flex items-center justify-center gap-2"
        >
          <Globe size={16} />
          Entrar com Google
        </button>

        <p className="mt-6 text-center text-xs text-text-secondary">
          {isRegister ? 'Ja tem conta?' : 'Nao tem conta?'}{' '}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-accent hover:underline"
          >
            {isRegister ? 'Entrar' : 'Criar conta'}
          </button>
        </p>
      </div>
    </div>
  );
}
