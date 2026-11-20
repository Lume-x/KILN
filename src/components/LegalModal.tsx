import { useEffect } from 'react';
import { X } from 'lucide-react';

export type LegalDocType = 'privacy' | 'terms' | null;

interface LegalModalProps {
  docType: LegalDocType;
  onClose: () => void;
}

export function LegalModal({ docType, onClose }: LegalModalProps) {
  useEffect(() => {
    if (!docType) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [docType, onClose]);

  if (!docType) return null;

  const isPrivacy = docType === 'privacy';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#171B19]/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#F7F6F2] border border-[#DAD7CE] rounded-sm p-6 sm:p-8 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#DAD7CE]">
          <div>
            <p className="text-xs text-[#59605B]">KILN Pilot Documentation · Draft Placeholder</p>
            <h2
              id="legal-modal-title"
              className="mt-1 font-display text-2xl font-semibold text-[#171B19]"
            >
              {isPrivacy ? 'Privacy Policy (Pilot Placeholder)' : 'Terms of Participation (Pilot Placeholder)'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document"
            className="w-10 h-10 inline-flex items-center justify-center rounded-sm border border-[#DAD7CE] text-[#171B19] hover:bg-[#EFECE4] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm leading-relaxed text-[#3F4541]">
          {isPrivacy ? (
            <>
              <p>
                This placeholder outlines KILN&apos;s privacy principles for the Federal University
                of Technology, Owerri (FUTO) and surrounding Owerri communities pilot. Full legal
                text will be published prior to live collection operations.
              </p>
              <p>
                <strong className="text-[#171B19]">Information collected:</strong> Account
                registration collects only the fields required to identify participants and organize
                local collection (name, email address, optional phone number, and community area).
              </p>
              <p>
                <strong className="text-[#171B19]">How data is used:</strong> Personal contact
                information and pickup addresses are strictly used to coordinate recycling
                collections, verify material weights, and manage reward wallets. KILN never publishes
                names, email addresses, phone numbers, or home addresses in public impact summaries.
              </p>
              <p>
                <strong className="text-[#171B19]">Access controls:</strong> Account records are
                protected by role-based server access controls so participants only view their own
                submissions and wallet records.
              </p>
            </>
          ) : (
            <>
              <p>
                These draft terms govern participation in the KILN community recycling pilot around
                FUTO and Owerri, Imo State, Nigeria. Final legal terms will be issued before live
                rewards begin.
              </p>
              <p>
                <strong className="text-[#171B19]">Eligible materials:</strong> KILN currently plans
                to accept clean, sorted plastic bottles, aluminium cans, dry paper, and flattened
                cardboard. Materials contaminated with liquids, food waste, oils, or hazardous
                substances may be rejected during inspection.
              </p>
              <p>
                <strong className="text-[#171B19]">Verification before rewards:</strong> Reward
                points are calculated solely from verified eligible weight recorded after physical
                inspection and administrative approval. Self-reported weight estimates do not
                generate rewards.
              </p>
              <p>
                <strong className="text-[#171B19]">Pilot rates and redemptions:</strong> Official
                reward rates and redemption options will be announced transparently once pilot
                operations open. KILN does not promise fixed financial payouts prior to verified rate
                configuration.
              </p>
            </>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-[#DAD7CE] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-[#17372D] text-[#F7F6F2] hover:bg-[#14532D] rounded-sm cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
