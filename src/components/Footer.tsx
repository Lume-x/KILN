import type { AppRoute } from '../types/kiln';
import type { LegalDocType } from './LegalModal';

interface FooterProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
  onOpenLegal: (doc: LegalDocType) => void;
}

export function Footer({ onNavigate, onOpenLegal }: FooterProps) {
  return (
    <footer className="bg-[#171B19] text-[#E6E4DC] border-t border-[#2A302D]">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12 border-b border-[#2A302D]">
          <div className="md:col-span-5">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/');
              }}
              className="font-display text-2xl font-bold tracking-tight text-[#F7F6F2]"
            >
              KILN
            </a>
            <p className="mt-2 text-sm font-medium text-[#D5D1C7]">Turn Waste Into Worth.</p>
            <p className="mt-4 text-sm leading-relaxed text-[#A7ADA8] max-w-md">
              A community recycling, recyclable material collection, physical weighing verification,
              and rewards platform built for the Federal University of Technology, Owerri (FUTO) and
              surrounding communities in Imo State, Nigeria.
            </p>
          </div>

          <div className="md:col-span-2">
            <h3 className="text-sm font-semibold text-[#F7F6F2]">Platform</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-[#B7BDB8]">
              <li>
                <a
                  href="/#about"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/', '#about');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  About KILN
                </a>
              </li>
              <li>
                <a
                  href="/#how-it-works"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/', '#how-it-works');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  How It Works
                </a>
              </li>
              <li>
                <a
                  href="/#materials"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/', '#materials');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  Accepted Materials
                </a>
              </li>
              <li>
                <a
                  href="/#pilot"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/', '#pilot');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  FUTO / Owerri Pilot
                </a>
              </li>
              <li>
                <a
                  href="/#learn"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/', '#learn');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  Learn
                </a>
              </li>
            </ul>
          </div>

          <div className="md:col-span-2">
            <h3 className="text-sm font-semibold text-[#F7F6F2]">Participate</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-[#B7BDB8]">
              <li>
                <a
                  href="/register"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/register');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  Start Recycling
                </a>
              </li>
              <li>
                <a
                  href="/login"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/login');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  Sign In
                </a>
              </li>
              <li>
                <a
                  href="/#partners"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/', '#partners');
                  }}
                  className="hover:text-[#F7F6F2] transition-colors"
                >
                  Partner With KILN
                </a>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3">
            <h3 className="text-sm font-semibold text-[#F7F6F2]">Pilot Contact</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-[#B7BDB8]">
              <li>FUTO &amp; Owerri West, Imo State, Nigeria</li>
              <li>Email: pilot@kiln.org.ng (placeholder)</li>
              <li>Phone: +234 (0) 800-KILN-PILOT (placeholder)</li>
            </ul>
          </div>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#9AA19C]">
          <p>&copy; {new Date().getFullYear()} KILN Resource Recovery. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => onOpenLegal('privacy')}
              className="hover:text-[#F7F6F2] underline-offset-4 hover:underline cursor-pointer"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => onOpenLegal('terms')}
              className="hover:text-[#F7F6F2] underline-offset-4 hover:underline cursor-pointer"
            >
              Terms of Participation
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
