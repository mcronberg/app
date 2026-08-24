import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://bogfoert-regnskab.mcronberg.chatgpt.site'),
  title: 'Bogført — enkel bogføring',
  description: 'Indlæs CSV-filer, validér posteringer og skab et enkelt regnskab.',
  openGraph: {
    title: 'Bogført',
    description: 'Dit regnskab, uden støj.',
    images: [{ url: '/og.png', width: 2048, height: 1152, alt: 'Bogført — Dit regnskab, uden støj.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bogført',
    description: 'Dit regnskab, uden støj.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="da">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
