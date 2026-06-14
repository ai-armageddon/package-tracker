import { getSafeNextPath } from '@/lib/auth';

interface LoginPageProps {
  searchParams?: {
    error?: string;
    next?: string;
  };
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const nextPath = getSafeNextPath(searchParams?.next);

  return (
    <div className="mx-auto max-w-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold">Sign in</h2>

        <form action="/api/auth/login" method="post" className="mt-5 space-y-4">
          <input type="hidden" name="next" value={nextPath} />

          <label className="block">
            <span className="text-sm text-gray-400">Username</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              defaultValue="admin"
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </label>

          <label className="block">
            <span className="text-sm text-gray-400">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </label>

          {searchParams?.error && (
            <p role="alert" className="text-sm text-red-400">
              Username or password is wrong.
            </p>
          )}

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 px-4 py-2 rounded text-sm font-medium transition-all duration-200"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
