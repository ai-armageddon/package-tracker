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
    <div className="mx-auto max-w-sm pt-6 sm:pt-14">
      <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-7 shadow-xl shadow-black/30">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-700/60 bg-gradient-to-br from-blue-500/20 via-gray-900 to-purple-500/15 text-xl shadow-inner">
            📦
          </span>
          <h2 className="text-lg font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-1 text-xs text-gray-500">
            Sign in to manage your tracked packages
          </p>
        </div>

        <form action="/api/auth/login" method="post" className="space-y-4">
          <input type="hidden" name="next" value={nextPath} />

          <label className="block">
            <span className="text-xs font-medium text-gray-400">Username</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              defaultValue="admin"
              className="mt-1.5 w-full rounded-md border border-gray-700/80 bg-gray-800/70 px-3 py-2 text-sm transition-all duration-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-400">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="mt-1.5 w-full rounded-md border border-gray-700/80 bg-gray-800/70 px-3 py-2 text-sm transition-all duration-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          {searchParams?.error && (
            <p
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              Username or password is wrong.
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium shadow-lg shadow-blue-950/30 transition-all duration-200 hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 active:scale-[0.98]"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
