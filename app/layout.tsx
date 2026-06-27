import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pipeline MDD asistido por IA",
  description: "Lenguaje natural -> CIM -> PIM -> PSM -> codigo -> Docker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <header className="bg-gray-900 text-white px-6 py-3">
          <a href="/" className="font-semibold">
            Pipeline MDD <span className="text-gray-400 font-normal">asistido por IA</span>
          </a>
        </header>
        <main className="max-w-5xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
