import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from '@/components/login-form';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SiteNav } from '@/components/site-nav';
import {
  MotionPage,
  MotionHeader,
  MotionFooter,
} from '@/components/motion/primitives';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sudah login -- tidak ada gunanya melihat form ini lagi.
  if (user) redirect('/');

  const { error } = await searchParams;

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight">
          Wagehold
        </h1>
        <SiteNav />
        <p className="ml-auto hidden text-[13px] italic text-muted sm:block">
          Work sealed. Wages shared.
        </p>
      </MotionHeader>

      <div className="flex flex-1 items-center justify-center overflow-auto py-2">
        <div className="w-full max-w-sm">
          <Panel>
            <PanelHeader title="Sign in" />
            {error && (
              <p className="border-b border-line bg-crit/10 px-3.5 py-2 text-[11.5px] text-crit">
                Sign-in didn&apos;t complete -- please try again below.
              </p>
            )}
            <LoginForm />
          </Panel>
        </div>
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
