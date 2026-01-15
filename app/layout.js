import './globals.css'

export const metadata = {
  title: 'EryAI Dashboard',
  description: 'Customer dashboard for EryAI',
}

export default function RootLayout({ children }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  )
}
