import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  integrationSettings,
  learningModules,
  materialCategories,
  redemptionSettings,
  rewardRates,
  storageLocations,
} from './schema.ts';

const DEMO_RATES_BY_SLUG: Record<string, string> = {
  'plastic-bottles': '50.00',
  'aluminium-cans': '120.00',
  paper: '30.00',
  cardboard: '35.00',
};

const INITIAL_STORAGE_LOCATIONS = [
  {
    name: 'FUTO Campus Pilot Holding Bay (Demo)',
    slug: 'futo-campus-holding-bay-demo',
    locationType: 'DEMO_STORAGE',
    address: 'Demo storage bay reference near FUTO Main Gate, Owerri West, Imo State',
    communityArea: 'FUTO Campus',
    description:
      'Demonstration storage entry for testing verified material receipt and batching. Not an operational physical warehouse.',
    capacityKg: '1500.00',
    isActive: true,
    isDemo: true,
  },
  {
    name: 'Ihiagwa Consolidation Staging Area (Demo)',
    slug: 'ihiagwa-staging-area-demo',
    locationType: 'DEMO_STORAGE',
    address: 'Demo transfer destination along Ihiagwa Market Road, Owerri West',
    communityArea: 'Ihiagwa',
    description:
      'Demonstration secondary storage location for testing inter-location material transfers and buyer dispatch records.',
    capacityKg: '2500.00',
    isActive: true,
    isDemo: true,
  },
];

const INITIAL_LEARNING_MODULES = [
  {
    slug: 'sorting-plastics-cans-paper-cardboard',
    title: 'Sorting Plastics, Cans, Paper and Cardboard',
    summary:
      'Learn how to separate, rinse, dry, and prepare accepted recyclable materials so your collections pass physical inspection with minimal rejection.',
    topic: 'Recycling Fundamentals',
    passingScorePercent: 67,
    bonusPoints: '25.00',
    isDemoBonus: true,
    isActive: true,
    displayOrder: 1,
    lessonsJson: JSON.stringify([
      {
        title: '1. Why Clean Separation Matters',
        englishBody:
          'Recyclers pay for clean, sorted materials. When plastic bottles are mixed with wet food scraps or oil-stained cardboard, entire bags can lose value and be rejected at the weighing scale. Separating materials into distinct bags keeps your eligible weight high.',
        pidginSummary:
          'If you separate plastic bottle, can, paper and carton well-well without dirty food or oil inside, agent go weigh am clean and your reward point go plenty pass.',
        example:
          'Keep clear PET water bottles in one sack and crushed aluminium drink cans in another bag rather than mixing them together.',
      },
      {
        title: '2. Preparing Plastic Bottles and Aluminium Cans',
        englishBody:
          'Empty all liquid completely from plastic bottles and beverage cans before collection. A quick shake or rinse prevents mould and odour. Crushing bottles and cans saves space during pickup or drop-off.',
        pidginSummary:
          'Pour out all water or drink wey remain inside bottle and can. You fit press dem flat so dem no go take space when you carry am go drop-off.',
        example:
          'A 1.5L PET bottle half-full of leftover soda adds false weight and causes the bottle to be marked as contaminated or rejected.',
      },
      {
        title: '3. Keeping Paper and Cardboard Dry',
        englishBody:
          'Clean lecture notes, office paper, and flattened corrugated shipping boxes are accepted only when dry and free of grease or paint. Rain-soaked or food-stained cartons cannot be pulped cleanly by recycling processors.',
        pidginSummary:
          'Make sure paper and carton dey dry well-well. No put carton wey stew, oil or rain water don soak inside your recycling bag.',
        example:
          'Flatten corrugated delivery boxes, remove heavy plastic tape where practical, and tie them into a neat dry bundle.',
      },
    ]),
    quizQuestionsJson: JSON.stringify([
      {
        id: 'q1',
        question: 'What determines the reward points you earn from a KILN collection?',
        options: [
          'The estimated weight you typed in the request form',
          'The administrator-verified eligible weight after physical inspection',
          'The AI waste sorter confidence percentage',
          'The total weight including liquid left inside bottles',
        ],
        correctIndex: 1,
        explanation:
          'Rewards are calculated strictly from verified eligible kilograms after an agent weighs the material and an administrator approves the record.',
      },
      {
        id: 'q2',
        question: 'Which cardboard condition is most likely to be rejected during inspection?',
        options: [
          'Flattened dry delivery boxes tied with twine',
          'Dry brown shipping cartons stacked neatly',
          'Grease-soaked food boxes or rain-damaged wet cardboard',
          'Clean corrugated boxes with labels removed',
        ],
        correctIndex: 2,
        explanation:
          'Oil, grease, and heavy moisture ruin paper and cardboard fibres during recycling processing.',
      },
      {
        id: 'q3',
        question: 'What should you do with plastic bottles before scheduling collection?',
        options: [
          'Leave leftover drinks inside to increase weight',
          'Empty all liquids completely and separate bottles from wet waste',
          'Burn the caps off before collection',
          'Mix them with kitchen organic scraps',
        ],
        correctIndex: 1,
        explanation:
          'Emptying liquids prevents contamination and ensures the actual weighed quantity reflects clean recyclable plastic.',
      },
    ]),
  },
  {
    slug: 'understanding-satoshis-and-bitcoin-lightning',
    title: 'Understanding Satoshis and Bitcoin Lightning',
    summary:
      'A practical, jargon-free introduction to satoshis, the Lightning Network, and how KILN reward points relate to optional Lightning redemptions.',
    topic: 'Bitcoin & Lightning Basics',
    passingScorePercent: 67,
    bonusPoints: '25.00',
    isDemoBonus: true,
    isActive: true,
    displayOrder: 2,
    lessonsJson: JSON.stringify([
      {
        title: '1. Points vs. Satoshis',
        englishBody:
          'When your recycling is verified on KILN, you earn KILN Reward Points in your ledger wallet. Reward points are not Bitcoin. When you choose to redeem points, you can pick traditional Nigerian methods (Bank Transfer, Airtime, Data, Campus Vouchers) or optionally Bitcoin Lightning.',
        pidginSummary:
          'KILN point no be Bitcoin by force. Na point you earn first, then when you wan collect am, you fit choose bank transfer, airtime, data, campus voucher, or Bitcoin Lightning.',
        example:
          '1 Bitcoin equals 100,000,000 satoshis (sats). Small everyday values are measured in sats instead of tiny fractions of a Bitcoin.',
      },
      {
        title: '2. What the Lightning Network Does',
        englishBody:
          'The Bitcoin Lightning Network is a payment layer built on top of Bitcoin that settles small transfers quickly with very low fees. A Lightning Address looks like an email address (for example, name@wallet.example), while a BOLT11 invoice is a one-time payment request starting with lnbc.',
        pidginSummary:
          'Lightning Network dey help send small Bitcoin (sats) sharp-sharp with small fee. Lightning address resemble email, and invoice na one-time code wey start with lnbc.',
        example:
          'In KILN demo mode, Lightning redemptions run as clearly labelled simulated payouts so pilot testers can learn safely without moving real funds.',
      },
      {
        title: '3. Transparent Conversion & Verification',
        englishBody:
          'Conversion rates between KILN points and satoshis are configured by administrators and clearly shown before you submit a redemption request. No payout is marked Paid without confirmed settlement or an explicit demo simulation notice.',
        pidginSummary:
          'Before you redeem, KILN go show you the exact rate and amount clearly. Demo test payout no be real money and KILN go always label am clear.',
        example:
          'Check the redemption preview box before clicking Submit so you know both the points deducted and the estimated payout value.',
      },
    ]),
    quizQuestionsJson: JSON.stringify([
      {
        id: 'q1',
        question: 'How many satoshis (sats) make 1 whole Bitcoin?',
        options: ['1,000 sats', '100,000 sats', '100,000,000 sats', '1,000,000 sats'],
        correctIndex: 2,
        explanation: 'One Bitcoin is divisible into 100 million satoshis (0.00000001 BTC each).',
      },
      {
        id: 'q2',
        question: 'Are KILN participants forced to redeem rewards in Bitcoin Lightning?',
        options: [
          'Yes, Bitcoin is the only payout option',
          'No — participants can also choose Bank Transfer, Airtime, Mobile Data, or Campus Vouchers',
          'Only administrators can redeem rewards',
          'Points can never be redeemed',
        ],
        correctIndex: 1,
        explanation:
          'Bitcoin Lightning is completely optional alongside Bank Transfer, Airtime, Mobile Data, and Campus Vouchers.',
      },
      {
        id: 'q3',
        question: 'How does KILN handle Lightning payouts when operating in Demo Mode?',
        options: [
          'It sends real money automatically without approval',
          'It generates fake blockchain preimages',
          'It runs a clearly labelled simulated workflow and never presents simulated payments as real Bitcoin',
          'It deletes the user wallet balance',
        ],
        correctIndex: 2,
        explanation:
          'Demo mode strictly labels simulated payouts and never pretends a real Bitcoin transfer occurred.',
      },
    ]),
  },
  {
    slug: 'wallet-security-nwc-permissions-scam-awareness',
    title: 'Wallet Security, NWC Permissions and Scam Awareness',
    summary:
      'Protect your accounts, understand what Nostr Wallet Connect (NWC) secrets can do, and spot common recycling or crypto scams.',
    topic: 'Wallet Safety & Scam Awareness',
    passingScorePercent: 67,
    bonusPoints: '25.00',
    isDemoBonus: true,
    isActive: true,
    displayOrder: 3,
    lessonsJson: JSON.stringify([
      {
        title: '1. Never Share Recovery Phrases or Private Keys',
        englishBody:
          'Your wallet recovery phrase (12 or 24 words) and Nostr private key (nsec) grant complete control over your funds or identity. No KILN agent, coordinator, or support person will ever ask for your password, bank PIN, seed phrase, or private key.',
        pidginSummary:
          'No give anybody your 12-word recovery phrase, bank PIN, password or nsec private key. KILN staff or agent no go ever ask you for am.',
        example:
          'If someone messages you claiming you won extra KILN rewards and asks for your seed phrase or OTP, report and block them immediately.',
      },
      {
        title: '2. Understanding NWC Connection Secrets',
        englishBody:
          'Nostr Wallet Connect (NWC) uses a secret connection URI (`nostr+walletconnect://...`) to let an app communicate with a Lightning wallet under specific permissions and spending budgets. Treat an NWC URI like a sensitive API key — never post it in screenshots, chats, or public forums.',
        pidginSummary:
          'NWC connection link get secret key inside am. Treat am like ATM PIN — no snap am send give friend or post am online.',
        example:
          'Always set a small spending budget limit in your wallet app when generating an NWC connection, and disconnect it whenever you stop using it.',
      },
      {
        title: '3. Verifying Genuine KILN Operations',
        englishBody:
          'Every legitimate KILN collection has a unique reference code (KILN-YYYYMMDD-XXXXXX) visible inside your Collections page, and every reward credit appears in your immutable Reward Ledger. Always verify collection agents and redemption statuses inside the app.',
        pidginSummary:
          'Check your KILN reference code inside the app before you hand over material, and confirm your reward inside your Wallet Ledger.',
        example:
          'Do not pay upfront "activation fees" to anyone claiming to speed up a KILN payout — KILN never charges upfront fees to release earned rewards.',
      },
    ]),
    quizQuestionsJson: JSON.stringify([
      {
        id: 'q1',
        question: 'Will a KILN agent or administrator ever ask for your wallet seed phrase or bank PIN?',
        options: [
          'Yes, during first pickup verification',
          'Yes, to process Lightning redemptions',
          'Never — KILN staff will never ask for passwords, PINs, seed phrases, or private keys',
          'Only on weekends',
        ],
        correctIndex: 2,
        explanation:
          'Legitimate platforms never require your private keys, PINs, or recovery phrases.',
      },
      {
        id: 'q2',
        question: 'How should you treat a Nostr Wallet Connect (NWC) URI?',
        options: [
          'Share it publicly as your username',
          'Treat it as a private secret credential with spending limits and never share it publicly',
          'Use it as your login password on other sites',
          'Print it on your recycling bag',
        ],
        correctIndex: 1,
        explanation:
          'An NWC URI contains a secret key that authorizes wallet actions; keep it private and scope its budget permissions.',
      },
      {
        id: 'q3',
        question: 'Someone asks you to pay an upfront fee to unlock your KILN reward points. What should you do?',
        options: [
          'Pay immediately so the points do not expire',
          'Share your login password so they can verify your balance',
          'Refuse — it is a scam; KILN never charges upfront fees to release verified rewards',
          'Send them your NWC connection URI',
        ],
        correctIndex: 2,
        explanation:
          'Upfront unlock fees are a classic scam pattern. All genuine redemption statuses appear directly in your KILN Wallet.',
      },
    ]),
  },
];

export async function seedStages4To8() {
  // 1. Seed clearly labelled DEMO initial reward rates for active recyclable categories if none exist
  const categories = await db
    .select()
    .from(materialCategories)
    .where(and(eq(materialCategories.streamType, 'RECYCLABLE'), eq(materialCategories.isActive, true)));

  for (const cat of categories) {
    const existingRates = await db
      .select({ id: rewardRates.id })
      .from(rewardRates)
      .where(eq(rewardRates.materialCategoryId, cat.id))
      .limit(1);

    const demoRate = DEMO_RATES_BY_SLUG[cat.slug] ?? '40.00';
    if (existingRates.length === 0) {
      await db.insert(rewardRates).values({
        materialCategoryId: cat.id,
        pointsPerKg: demoRate,
        isActive: true,
        isDemo: true,
        reason: 'Initial Stage 4 pilot demonstration rate (DEMO — configurable by administrator)',
      });
      await db
        .update(materialCategories)
        .set({
          rewardRateDemo: demoRate,
          isRateConfigured: true,
          updatedAt: new Date(),
        })
        .where(eq(materialCategories.id, cat.id));
    }
  }

  // 2. Seed single redemption_settings row if empty
  const existingRedemptionSettings = await db.select({ id: redemptionSettings.id }).from(redemptionSettings).limit(1);
  if (existingRedemptionSettings.length === 0) {
    await db.insert(redemptionSettings).values({
      minRedemptionPoints: '50.00',
      pointsToNgnRate: '1.0000',
      pointsToSatsRate: '10.0000',
      enabledMethodsJson: JSON.stringify([
        'BITCOIN_LIGHTNING',
        'BANK_TRANSFER',
        'AIRTIME',
        'MOBILE_DATA',
        'CAMPUS_VOUCHER',
      ]),
      failedRedemptionPolicy: 'AUTO_REFUND_TO_WALLET',
      isDemoRates: true,
    });
  }

  // 3. Seed single integration_settings row if empty
  const existingIntSettings = await db.select({ id: integrationSettings.id }).from(integrationSettings).limit(1);
  if (existingIntSettings.length === 0) {
    await db.insert(integrationSettings).values({
      lightningEnabled: true,
      lightningMode: 'DEMO',
      nwcStatus: 'DISCONNECTED',
      nostrEnabled: true,
      nostrMode: 'DEMO',
      nostrRelayUrlsJson: JSON.stringify(['wss://relay.damus.io', 'wss://nos.lol']),
      nostrAutoPublish: false,
      aiSorterEnabled: true,
      aiProvider: 'GEMINI',
    });
  }

  // 4. Seed clearly labelled DEMO storage locations if empty
  for (const loc of INITIAL_STORAGE_LOCATIONS) {
    await db
      .insert(storageLocations)
      .values(loc)
      .onConflictDoNothing({ target: storageLocations.slug });
  }

  // 5. Seed the 3 Learn & Earn educational modules
  for (const mod of INITIAL_LEARNING_MODULES) {
    await db
      .insert(learningModules)
      .values(mod)
      .onConflictDoNothing({ target: learningModules.slug });
  }
}

// Allow direct CLI execution via `npx tsx src/db/seed-stages-4-8.ts`
const isDirectRun = process.argv[1]?.endsWith('seed-stages-4-8.ts');
if (isDirectRun) {
  seedStages4To8()
    .then(() => {
      console.log('Seeded Stage 4-8 baseline configuration, demo rates, demo storage locations, and learning modules.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Stage 4-8 seed failed:', err);
      process.exit(1);
    });
}
