'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';
import type { Theme } from '@/lib/theme';

export function Providers({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  // One client per browser tab, created lazily so a re-render never swaps it.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Availability is the point of this product; nothing here is
            // fresh for long.
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // A 403 will not become a 200 by asking again.
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status ?? 0;
              return status >= 500 && failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initial={theme}>
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
