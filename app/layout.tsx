import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Isunday Stream Live - Live Streaming Platform',
  description: 'Stream your events live to viewers anywhere. Easy phone streaming, real-time chat, and automatic recording.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning is intentional here: browser extensions
    // (Grammarly, Loom, ColorZilla, dark-mode helpers, password managers,
    // etc.) commonly inject attributes / inline styles onto <html> and
    // <body> before React hydrates, producing a console "hydration mismatch"
    // diff like style={{zIndex:0}}. Next.js recommends this exact opt-out
    // for elements known to be touched outside React's control:
    // https://nextjs.org/docs/messages/react-hydration-error
    <html lang="en" className="bg-background" suppressHydrationWarning>
      {/*
        esbuild `__name` polyfill — must run before ANY module code.
        @supabase/ssr (and several other tsup-compiled packages) are built
        with keepNames:true, which emits `__name(Fn, "Fn")` calls.
        When Turbopack or @opennextjs/cloudflare reprocess those bundles the
        helper definition gets separated from its call sites, causing:
          ReferenceError: __name is not defined
        Defining it here as a synchronous inline script makes it available
        on `window` before any deferred or module script executes.
      */}
      <head>
        {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
        <script
          // biome-ignore lint: polyfill must use dangerouslySetInnerHTML
          dangerouslySetInnerHTML={{
            __html:
              "var __defProp=Object.defineProperty;" +
              "var __name=function(t,v){" +
              "  __defProp(t,'name',{value:v,configurable:true});" +
              "  return t;" +
              "};",
          }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  )
}
