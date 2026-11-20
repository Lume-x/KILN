import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Scale } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { MaterialCard } from './MaterialCard';
import type {
  AppRoute,
  CollectionPoint,
  ImpactSummary,
  MaterialCategory,
} from '../types/kiln';

interface PublicHomePageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
}

const HERO_IMAGE_PATH = '/src/assets/images/hero_kiln_sorting_1795195681853.jpg';

const HOW_IT_WORKS_STEPS = [
  {
    number: '01',
    title: 'Sort accepted recyclables',
    summary:
      'Keep plastic bottles, aluminium cans, dry paper, and flattened cardboard clean and separated from food waste or liquids.',
  },
  {
    number: '02',
    title: 'Choose pickup or drop-off',
    summary:
      'Create a free KILN account and either request a scheduled pickup from your lodge, home, or shop, or take your materials to an approved pilot drop-off point.',
  },
  {
    number: '03',
    title: 'Physical inspection and weighing',
    summary:
      'A KILN collection agent checks the condition of your materials, removes contaminated items, and weighs the eligible quantity on a physical scale.',
  },
  {
    number: '04',
    title: 'Verification and reward credit',
    summary:
      'Once the recorded weight is verified, reward points are credited to your account wallet based strictly on verified eligible kilograms.',
  },
  {
    number: '05',
    title: 'Materials enter recycling recovery',
    summary:
      'Collected materials are sorted into clean batches and supplied to recycling processors instead of being burned or dumped.',
  },
];

const PARTNER_CATEGORIES = [
  {
    value: 'RECYCLING_BUSINESS',
    label: 'Recycling Business / Material Buyer',
    summary: 'Processors and off-takers interested in clean, weighed, traceable batches of PET, aluminium, paper, or cardboard.',
  },
  {
    value: 'COMMUNITY_ORG',
    label: 'Community or Student Organisation',
    summary: 'FUTO faculties, student associations, estate committees, and civic groups organising clean-up or sorting drives.',
  },
  {
    value: 'LOCAL_BUSINESS',
    label: 'Shop, Eatery, or Local Business',
    summary: 'Hostel vendors, print shops, supermarkets, and offices generating regular volumes of bottles, cans, paper, or cartons.',
  },
  {
    value: 'COLLECTION_PARTNER',
    label: 'Collection & Logistics Partner',
    summary: 'Local collection agents, transport operators, or premises able to host an approved pilot drop-off desk.',
  },
] as const;

export function PublicHomePage({ onNavigate }: PublicHomePageProps) {
  const { user } = useAuth();

  const [materials, setMaterials] = useState<MaterialCategory[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>('all');

  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [impact, setImpact] = useState<ImpactSummary | null>(null);
  const [heroImageError, setHeroImageError] = useState(false);

  // Partnership inquiry form state
  const [organizationName, setOrganizationName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [partnerType, setPartnerType] = useState<string>('RECYCLING_BUSINESS');
  const [message, setMessage] = useState('');
  const [submittingPartner, setSubmittingPartner] = useState(false);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [partnerSuccess, setPartnerSuccess] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPublicData() {
      setMaterialsLoading(true);
      setMaterialsError(null);

      try {
        const [matRes, pointsRes, impactRes] = await Promise.all([
          fetch('/api/public/materials'),
          fetch('/api/public/collection-points'),
          fetch('/api/public/impact'),
        ]);

        if (!active) return;

        if (matRes.ok) {
          const matData = await matRes.json();
          setMaterials(Array.isArray(matData.materials) ? matData.materials : []);
        } else {
          setMaterialsError('Could not load accepted materials from the database right now.');
        }

        if (pointsRes.ok) {
          const pointsData = await pointsRes.json();
          setCollectionPoints(
            Array.isArray(pointsData.collectionPoints) ? pointsData.collectionPoints : []
          );
        }

        if (impactRes.ok) {
          const impactData = await impactRes.json();
          setImpact(impactData.impact ?? null);
        }
      } catch (err) {
        console.error('Failed loading public KILN data:', err);
        if (active) {
          setMaterialsError('Network error while loading accepted materials. Please refresh.');
        }
      } finally {
        if (active) {
          setMaterialsLoading(false);
        }
      }
    }

    loadPublicData();
    return () => {
      active = false;
    };
  }, []);

  const visibleMaterials =
    selectedSlug === 'all'
      ? materials
      : materials.filter((item) => item.slug === selectedSlug);

  async function handlePartnershipSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPartnerError(null);
    setPartnerSuccess(null);
    setSubmittingPartner(true);

    try {
      const res = await fetch('/api/public/partnerships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName,
          contactName,
          email,
          phone,
          partnerType,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPartnerError(data.error || 'Please check your inquiry details and try again.');
        return;
      }

      setPartnerSuccess({
        id: data.inquiry.id,
        message: data.message,
      });
      setOrganizationName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setMessage('');
    } catch {
      setPartnerError('Unable to reach the server right now. Please try again shortly.');
    } finally {
      setSubmittingPartner(false);
    }
  }

  return (
    <main>
      {/* 1. HERO — First-Time Visitor Clarity (Understood in 5-10 seconds) */}
      <section className="border-b border-[#DAD7CE] bg-[#F7F6F2]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-12 lg:pt-16 lg:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
            {/* Editorial Proposition Column */}
            <div className="lg:col-span-5 flex flex-col justify-between">
              <div>
                <p className="text-xs font-medium text-[#59605B] tracking-wide">
                  Community Recycling Service · FUTO &amp; Owerri Pilot
                </p>

                <h1 className="mt-4 font-display text-[clamp(2.15rem,3.6vw,3.35rem)] font-bold leading-[1.08] tracking-tight text-[#171B19]">
                  Recycle plastics, cans, paper, and cardboard. Get weighed, verified, and rewarded.
                </h1>

                <p className="mt-5 text-base leading-relaxed text-[#3F4541]">
                  KILN is a recyclable material collection platform for students, households, and
                  local businesses around FUTO and Owerri. Sort accepted recyclables, submit them by
                  pickup or approved drop-off, have them physically inspected and weighed, and earn
                  rewards for every verified kilogram.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-5">
                  <button
                    type="button"
                    onClick={() => onNavigate(user ? '/collections' : '/register')}
                    className="min-h-[44px] px-6 py-3 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm transition-colors duration-150 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <span>{user ? 'Request Collection' : 'Start Recycling'}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <a
                    href="#how-it-works"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate('/', '#how-it-works');
                    }}
                    className="min-h-[44px] inline-flex items-center text-sm font-semibold text-[#17372D] underline underline-offset-4 hover:text-[#14532D] whitespace-nowrap"
                  >
                    See how it works
                  </a>
                </div>
              </div>

              <p className="mt-8 pt-6 border-t border-[#DAD7CE] text-xs leading-relaxed text-[#59605B]">
                Turn Waste Into Worth. No membership fees. Rewards are issued only after physical
                inspection and weight verification.
              </p>
            </div>

            {/* Documentary Photography Focal Anchor */}
            <div className="lg:col-span-7 flex flex-col">
              <figure className="flex-1 flex flex-col bg-[#EFECE4] border border-[#DAD7CE] rounded-sm overflow-hidden">
                <div className="flex-1 min-h-[260px] sm:min-h-[340px] lg:min-h-[400px] bg-[#E6E2D8]">
                  {!heroImageError ? (
                    <img
                      src={HERO_IMAGE_PATH}
                      alt="Sorted corrugated cardboard bundles, clear plastic bottles, and aluminium cans being weighed on a platform scale by a collection agent"
                      referrerPolicy="no-referrer"
                      onError={() => setHeroImageError(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-[#59605B]">
                      <Scale className="w-10 h-10 text-[#17372D] mb-3" aria-hidden="true" />
                      <p className="text-sm font-medium text-[#171B19]">
                        Physical weighing and inspection at collection
                      </p>
                    </div>
                  )}
                </div>
                <figcaption className="px-4 py-3 bg-[#F7F6F2] border-t border-[#DAD7CE] text-xs text-[#59605B] flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Every submission is physically inspected and weighed before rewards are calculated.
                  </span>
                  <span className="font-mono text-[#17372D]">FUTO · Owerri Pilot</span>
                </figcaption>
              </figure>
            </div>
          </div>

          {/* Full-width plain-English summary strip directly under the hero split */}
          <div className="mt-10 pt-8 border-t border-[#DAD7CE] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-xs font-medium text-[#59605B]">Accepted materials</p>
              <p className="mt-1 text-sm font-semibold text-[#171B19]">
                Plastic bottles, aluminium cans, paper, and cardboard
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#59605B]">How you submit</p>
              <p className="mt-1 text-sm font-semibold text-[#171B19]">
                Scheduled pickup or approved drop-off points
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#59605B]">How weight is checked</p>
              <p className="mt-1 text-sm font-semibold text-[#171B19]">
                Physically inspected and weighed in kilograms
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#59605B]">How rewards work</p>
              <p className="mt-1 text-sm font-semibold text-[#171B19]">
                Credited after verified eligible weight is approved
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. WHAT KILN DOES (#about) */}
      <section id="about" className="border-b border-[#DAD7CE] bg-[#EFECE4]/60">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-4">
              <p className="text-xs font-medium text-[#59605B]">What KILN does</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-[#171B19]">
                Turning everyday recyclables into tracked, verified value.
              </h2>
            </div>

            <div className="lg:col-span-8 space-y-5 text-base leading-relaxed text-[#3F4541]">
              <p>
                Across hostels, homes, and shops around FUTO and Owerri, reusable plastics, cans,
                paper, and cartons are routinely thrown into general refuse because there is no
                reliable way to sort, submit, and get fair credit for them.
              </p>
              <p>
                KILN builds the missing bridge between everyday communities and recycling processors.
                Participants submit clean, sorted materials; trained collection agents inspect and
                weigh them; verified quantities earn transparent rewards; and recovered materials
                move cleanly into the recycling supply chain.
              </p>

              <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-6 border-t border-[#DAD7CE]">
                <div>
                  <h3 className="font-display text-lg font-semibold text-[#171B19]">
                    Today: Clean Recyclable Recovery
                  </h3>
                  <p className="mt-1.5 text-sm text-[#59605B] leading-relaxed">
                    Our pilot focuses strictly on four recyclable streams: PET plastic bottles,
                    aluminium cans, dry paper, and corrugated cardboard—tracked from submission to
                    recycling buyer.
                  </p>
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold text-[#171B19]">
                    Long-Term Architecture
                  </h3>
                  <p className="mt-1.5 text-sm text-[#59605B] leading-relaxed">
                    KILN separates recyclable materials from organic waste streams so the platform
                    can expand responsibly into future community resource recovery initiatives once
                    core recycling operations mature.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. HOW IT WORKS (#how-it-works) — Editorial 5-Step Specification Ledger */}
      <section id="how-it-works" className="border-b border-[#DAD7CE] bg-[#F7F6F2]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-[#59605B]">How It Works</p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
              Five clear steps from sorting to verified rewards.
            </h2>
            <p className="mt-3 text-base text-[#3F4541] leading-relaxed">
              You do not need special equipment or technical knowledge to recycle with KILN. Here is
              the complete process from start to finish.
            </p>
          </div>

          <ol className="mt-10 divide-y divide-[#DAD7CE] border-t border-b border-[#DAD7CE]">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <li
                key={step.number}
                className="py-6 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-8 items-baseline"
              >
                <div className="md:col-span-2 font-mono text-sm font-medium text-[#17372D] tabular-nums">
                  Step {step.number}
                </div>
                <div className="md:col-span-4">
                  <h3 className="font-display text-xl font-semibold text-[#171B19]">
                    {step.title}
                  </h3>
                </div>
                <div className="md:col-span-6 text-sm sm:text-base text-[#3F4541] leading-relaxed">
                  {step.summary}
                </div>
              </li>
            ))}
          </ol>

          {/* Transparent Rewards Clarification Band */}
          <div className="mt-10 p-6 sm:p-8 bg-[#17372D] text-[#F7F6F2] rounded-sm grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            <div className="lg:col-span-8">
              <p className="text-xs text-[#C6D5CD]">How rewards are calculated</p>
              <h3 className="mt-1.5 font-display text-2xl font-semibold text-[#F7F6F2]">
                Rewards are credited only after physical verification.
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#D8E2DC]">
                When you submit materials, only clean, eligible kilograms measured on a scale and
                verified by KILN count toward your reward balance. Official pilot points-per-kilogram
                rates are configured and published transparently before live collection opens—we do
                not promise fixed payouts ahead of verified rates. Verified points will be
                redeemable through approved local options including airtime, mobile data, bank
                transfer, campus vouchers, or optional digital payouts.
              </p>
            </div>
            <div className="lg:col-span-4 flex lg:justify-end">
              <button
                type="button"
                onClick={() => onNavigate(user ? '/account' : '/register')}
                className="min-h-[44px] px-5 py-3 text-sm font-semibold bg-[#F7F6F2] text-[#17372D] hover:bg-[#EFECE4] rounded-sm transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                {user ? 'View Your Account' : 'Create Free Account'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 4. ACCEPTED MATERIALS (#materials) — Database-Backed */}
      <section id="materials" className="border-b border-[#DAD7CE] bg-[#EFECE4]/50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-[#59605B]">
                Accepted Materials · Loaded from KILN catalogue
              </p>
              <h2 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
                What KILN accepts and how to prepare it.
              </h2>
              <p className="mt-3 text-base text-[#3F4541] leading-relaxed">
                Clean, dry, sorted materials hold higher recycling value and pass inspection faster.
                Review the preparation requirements below before packing your items.
              </p>
            </div>

            {/* Interactive filter tabs */}
            {materials.length > 0 && (
              <div
                role="tablist"
                aria-label="Filter accepted materials"
                className="flex flex-wrap items-center gap-1 p-1 bg-[#E5E2D9] rounded-sm self-start lg:self-auto"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedSlug === 'all'}
                  onClick={() => setSelectedSlug('all')}
                  className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
                    selectedSlug === 'all'
                      ? 'bg-[#17372D] text-[#F7F6F2]'
                      : 'text-[#3F4541] hover:text-[#171B19]'
                  }`}
                >
                  All ({materials.length})
                </button>
                {materials.map((mat) => (
                  <button
                    key={mat.slug}
                    type="button"
                    role="tab"
                    aria-selected={selectedSlug === mat.slug}
                    onClick={() => setSelectedSlug(mat.slug)}
                    className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
                      selectedSlug === mat.slug
                        ? 'bg-[#17372D] text-[#F7F6F2]'
                        : 'text-[#3F4541] hover:text-[#171B19]'
                    }`}
                  >
                    {mat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {materialsLoading ? (
            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white border border-[#DAD7CE] rounded-sm p-6 animate-pulse"
                >
                  <div className="aspect-[4/3] bg-[#E6E3DA] mb-5" />
                  <div className="h-6 bg-[#E6E3DA] w-1/2 mb-3" />
                  <div className="h-4 bg-[#E6E3DA] w-full mb-2" />
                  <div className="h-4 bg-[#E6E3DA] w-5/6" />
                </div>
              ))}
            </div>
          ) : materialsError ? (
            <div className="mt-10 p-6 bg-white border border-[#DAD7CE] rounded-sm text-sm text-[#8A4E11]">
              {materialsError}
            </div>
          ) : visibleMaterials.length === 0 ? (
            <div className="mt-10 p-6 bg-white border border-[#DAD7CE] rounded-sm text-sm text-[#59605B]">
              No active recyclable material categories are currently configured.
            </div>
          ) : (
            <div
              className={`mt-10 grid grid-cols-1 ${
                visibleMaterials.length === 1 ? 'md:grid-cols-1 max-w-2xl' : 'md:grid-cols-2'
              } gap-6`}
            >
              {visibleMaterials.map((material, idx) => (
                <MaterialCard key={material.id} material={material} index={idx} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 5. PICKUP VS. DROP-OFF & PILOT SERVICE AREA (#pilot) */}
      <section id="pilot" className="border-b border-[#DAD7CE] bg-[#F7F6F2]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
          <div className="max-w-3xl">
            <p className="text-xs font-medium text-[#59605B]">
              Collection Methods &amp; Pilot Service Area
            </p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
              Built for FUTO and surrounding Owerri communities.
            </h2>
            <p className="mt-3 text-base text-[#3F4541] leading-relaxed">
              KILN is launching as a focused community pilot serving the Federal University of
              Technology, Owerri (FUTO) campus and nearby communities including Ihiagwa, Eziobodo,
              Obinze, Umuchima, and Nekede in Imo State, Nigeria.
            </p>
          </div>

          {/* Pickup vs Drop-off Comparison */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
              <p className="text-xs font-mono text-[#17372D]">Method 01 · Scheduled Pickup</p>
              <h3 className="mt-2 font-display text-2xl font-semibold text-[#171B19]">
                Collection at your hostel, home, or shop
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#3F4541]">
                Best when you have accumulated a bag or bundle of sorted recyclables and prefer a
                collection agent to come to you within the pilot area.
              </p>
              <ul className="mt-5 pt-5 border-t border-[#E6E3DA] space-y-2.5 text-sm text-[#3F4541]">
                <li>Provide your community area, street or lodge landmark, and preferred time window.</li>
                <li>An assigned KILN agent inspects and weighs your materials at handover.</li>
                <li>Your verified weight is logged directly against your collection reference code.</li>
              </ul>
            </div>

            <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
              <p className="text-xs font-mono text-[#17372D]">Method 02 · Approved Drop-Off</p>
              <h3 className="mt-2 font-display text-2xl font-semibold text-[#171B19]">
                Bring sorted materials to a pilot hub
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#3F4541]">
                Best for students and nearby residents submitting smaller or frequent batches while
                passing through campus or community collection desks.
              </p>
              <ul className="mt-5 pt-5 border-t border-[#E6E3DA] space-y-2.5 text-sm text-[#3F4541]">
                <li>Select an approved pilot collection point and operating window.</li>
                <li>Have materials inspected and weighed on-site on a calibrated scale.</li>
                <li>Receive a digital submission record linked to your KILN account.</li>
              </ul>
            </div>
          </div>

          {/* Planned Pilot Collection Points (Transparently labelled) */}
          <div className="mt-10 bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-5 border-b border-[#DAD7CE]">
              <div>
                <h3 className="font-display text-xl font-semibold text-[#171B19]">
                  Planned FUTO &amp; Owerri Drop-Off Points
                </h3>
                <p className="mt-1 text-sm text-[#59605B]">
                  Transparency notice: these entries represent planned pilot zones in our database.
                  Walk-in drop-off desks are not yet open until Stage 3 collection launch is
                  confirmed.
                </p>
              </div>
              <span className="font-mono text-xs text-[#8A4E11] whitespace-nowrap shrink-0">
                Pilot Preparation Phase
              </span>
            </div>

            {collectionPoints.length > 0 ? (
              <div className="mt-5 divide-y divide-[#DAD7CE]">
                {collectionPoints.map((pt) => (
                  <div
                    key={pt.id}
                    className="py-4 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-6 text-sm"
                  >
                    <div className="md:col-span-4 font-semibold text-[#171B19]">
                      {pt.name}
                      <div className="mt-0.5 text-xs font-normal text-[#59605B]">
                        Area: {pt.communityArea} · Status: {pt.status}
                        {pt.isDemo ? ' (Demo planning record)' : ''}
                      </div>
                    </div>
                    <div className="md:col-span-5 text-[#3F4541]">{pt.address}</div>
                    <div className="md:col-span-3 text-xs text-[#59605B] md:text-right">
                      {pt.operatingHours}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[#59605B]">
                Pilot collection point schedules will be published here as soon as host locations are
                confirmed.
              </p>
            )}
          </div>

          {/* Community Impact Record (Adjacent real DB record — zero fabricated data) */}
          <div className="mt-10 pt-10 border-t border-[#DAD7CE]">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#59605B]">
                  Community Impact Record · Direct Database Count
                </p>
                <h3 className="mt-1 font-display text-2xl font-semibold text-[#171B19]">
                  Verified pilot progress—never estimated or fabricated.
                </h3>
              </div>
              <p className="text-xs text-[#59605B] max-w-sm">
                Figures below reflect actual records stored in KILN&apos;s PostgreSQL database.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Verified weight collected</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {impact ? `${impact.verifiedKilograms} kg` : '0.00 kg'}
                </p>
              </div>
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Verified collections</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {impact ? impact.verifiedCollections : 0}
                </p>
              </div>
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Registered participants</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {impact ? impact.registeredParticipants : 0}
                </p>
              </div>
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Accepted material categories</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {impact ? impact.acceptedMaterialCategories : materials.length}
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs text-[#59605B]">
              {impact?.hasVerifiedCollections
                ? 'Live verified collection totals updated from approved weighing records.'
                : 'No live collections have been weighed yet. Verified kilograms and collection counts will update automatically once Stage 3 physical weighing and approval workflows open.'}
            </p>
          </div>
        </div>
      </section>

      {/* 6. LEARN (#learn) — Recycling Education Preview */}
      <section id="learn" className="border-b border-[#DAD7CE] bg-[#EFECE4]/60">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5">
              <p className="text-xs font-medium text-[#59605B]">Learn With KILN</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-[#171B19]">
                Practical sorting guides in plain English and Nigerian Pidgin.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-[#3F4541]">
                Good recycling starts before pickup. Inside your KILN account, short practical
                lessons will help you sort materials cleanly, avoid common rejections, and manage
                your recycling rewards safely.
              </p>
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => onNavigate(user ? '/account' : '/register')}
                  className="min-h-[44px] px-5 py-2.5 text-sm font-medium text-[#17372D] border border-[#17372D] hover:bg-[#17372D] hover:text-[#F7F6F2] rounded-sm transition-colors duration-150 cursor-pointer"
                >
                  {user ? 'Go to My Account' : 'Register for Pilot Access'}
                </button>
              </div>
            </div>

            <div className="lg:col-span-7 divide-y divide-[#DAD7CE] border-t border-b border-[#DAD7CE]">
              <div className="py-5">
                <p className="text-xs font-mono text-[#17372D]">Guide 01 · Material Preparation</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-[#171B19]">
                  Sorting Plastics, Cans, Paper, and Cardboard
                </h3>
                <p className="mt-1.5 text-sm text-[#3F4541] leading-relaxed">
                  How to empty and rinse PET bottles, separate aluminium drink cans from steel tins,
                  keep paper dry during rainy season, and flatten cartons so every kilogram passes
                  inspection.
                </p>
              </div>

              <div className="py-5">
                <p className="text-xs font-mono text-[#17372D]">Guide 02 · Avoiding Rejections</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-[#171B19]">
                  Why Clean Sorting Protects Your Eligible Weight
                </h3>
                <p className="mt-1.5 text-sm text-[#3F4541] leading-relaxed">
                  Understand what collection agents check on-site—liquid weight, grease stains,
                  mixed trash—and how simple household habits increase your verified yield.
                </p>
              </div>

              <div className="py-5">
                <p className="text-xs font-mono text-[#17372D]">Guide 03 · Safe Reward Redemptions</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-[#171B19]">
                  Understanding Payout Options and Account Safety
                </h3>
                <p className="mt-1.5 text-sm text-[#3F4541] leading-relaxed">
                  Clear guidance on redeeming verified points, protecting your account credentials,
                  recognising scams, and using optional digital payout tools safely when launched.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. PARTNERSHIPS & CONTACT (#partners) */}
      <section id="partners" className="bg-[#F7F6F2]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5">
              <p className="text-xs font-medium text-[#59605B]">Partnerships &amp; Contact</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-[#171B19]">
                Work with KILN on the FUTO &amp; Owerri pilot.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-[#3F4541]">
                We are building genuine local partnerships before scaling collection volumes. If
                your organisation buys recyclables, hosts a community space, or wants to organise
                campus or neighbourhood sorting, get in touch directly.
              </p>

              <ul className="mt-8 space-y-5">
                {PARTNER_CATEGORIES.map((item) => (
                  <li key={item.value} className="pt-4 border-t border-[#DAD7CE]">
                    <h3 className="text-sm font-semibold text-[#171B19]">{item.label}</h3>
                    <p className="mt-1 text-sm text-[#59605B] leading-relaxed">{item.summary}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-7">
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
                <h3 className="font-display text-2xl font-semibold text-[#171B19]">
                  Send a partnership or pilot inquiry
                </h3>
                <p className="mt-1.5 text-sm text-[#59605B]">
                  Inquiries are saved directly for the KILN pilot coordination team.
                </p>

                {partnerSuccess ? (
                  <div
                    role="status"
                    className="mt-6 p-5 bg-[#EFECE4] border border-[#17372D] rounded-sm"
                  >
                    <div className="flex items-start gap-3">
                      <CheckCircle2
                        className="w-5 h-5 text-[#17372D] shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-sm font-semibold text-[#171B19]">
                          Inquiry recorded (Ref #{partnerSuccess.id})
                        </p>
                        <p className="mt-1 text-sm text-[#3F4541]">{partnerSuccess.message}</p>
                        <button
                          type="button"
                          onClick={() => setPartnerSuccess(null)}
                          className="mt-4 text-xs font-semibold text-[#17372D] underline underline-offset-4 cursor-pointer"
                        >
                          Submit another inquiry
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handlePartnershipSubmit} className="mt-6 space-y-4" noValidate>
                    {partnerError && (
                      <div
                        role="alert"
                        className="p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
                      >
                        {partnerError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="partner-org"
                          className="block text-sm font-medium text-[#171B19]"
                        >
                          Organisation or group name
                        </label>
                        <input
                          id="partner-org"
                          type="text"
                          required
                          value={organizationName}
                          onChange={(e) => setOrganizationName(e.target.value)}
                          placeholder="e.g. Owerri Plastics Recovery Ltd"
                          className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19] placeholder:text-[#787F7A]"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="partner-contact"
                          className="block text-sm font-medium text-[#171B19]"
                        >
                          Contact person
                        </label>
                        <input
                          id="partner-contact"
                          type="text"
                          required
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder="Your full name"
                          className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19] placeholder:text-[#787F7A]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="partner-email"
                          className="block text-sm font-medium text-[#171B19]"
                        >
                          Email address
                        </label>
                        <input
                          id="partner-email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="name@organisation.org"
                          className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19] placeholder:text-[#787F7A]"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="partner-phone"
                          className="block text-sm font-medium text-[#171B19]"
                        >
                          Phone number <span className="text-[#59605B] font-normal">(optional)</span>
                        </label>
                        <input
                          id="partner-phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+234 ..."
                          className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19] placeholder:text-[#787F7A]"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="partner-type"
                        className="block text-sm font-medium text-[#171B19]"
                      >
                        Partnership category
                      </label>
                      <select
                        id="partner-type"
                        value={partnerType}
                        onChange={(e) => setPartnerType(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                      >
                        {PARTNER_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                        <option value="GENERAL">General Pilot Inquiry</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="partner-message"
                        className="block text-sm font-medium text-[#171B19]"
                      >
                        How would you like to collaborate?
                      </label>
                      <textarea
                        id="partner-message"
                        rows={4}
                        required
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Tell us about your materials, location in Owerri/FUTO, or how you would like to participate in the pilot."
                        className="mt-1.5 w-full px-3.5 py-2.5 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19] placeholder:text-[#787F7A]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submittingPartner}
                      className="min-h-[44px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm transition-colors duration-150 cursor-pointer"
                    >
                      {submittingPartner ? 'Sending inquiry...' : 'Send Partnership Inquiry'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
