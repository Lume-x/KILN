import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  collectionAgentProfiles,
  rewardWallets,
  userProfiles,
  users,
  type UserRole,
} from './schema.ts';
import { hashPassword } from '../lib/security.ts';

interface DemoAccountSpec {
  uid: string;
  email: string;
  password: string;
  fullName: string;
  phoneNumber: string;
  role: UserRole;
  communityArea: string;
  serviceZone?: string;
}

const DEMO_ACCOUNTS: DemoAccountSpec[] = [
  {
    uid: 'kiln_demo_admin_001',
    email: 'admin@kiln.demo',
    password: 'KilnAdmin2026!',
    fullName: 'KILN Pilot Administrator (Demo)',
    phoneNumber: '+2348000000001',
    role: 'ADMIN',
    communityArea: 'FUTO Campus',
  },
  {
    uid: 'kiln_demo_agent_001',
    email: 'agent@kiln.demo',
    password: 'KilnAgent2026!',
    fullName: 'Emeka Okafor (Demo Agent)',
    phoneNumber: '+2348000000002',
    role: 'AGENT',
    communityArea: 'Ihiagwa',
    serviceZone: 'FUTO Campus, Ihiagwa & Eziobodo',
  },
  {
    uid: 'kiln_demo_user_001',
    email: 'student@kiln.demo',
    password: 'KilnUser2026!',
    fullName: 'Chidinma Eze (Demo Participant)',
    phoneNumber: '+2348000000003',
    role: 'USER',
    communityArea: 'FUTO Campus',
  },
];

export async function seedDemoAccounts() {
  for (const spec of DEMO_ACCOUNTS) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, spec.email))
      .limit(1);

    let userId: number;
    if (existing.length > 0) {
      userId = existing[0].id;
    } else {
      const [inserted] = await db
        .insert(users)
        .values({
          uid: spec.uid,
          email: spec.email,
          passwordHash: hashPassword(spec.password),
          fullName: spec.fullName,
          phoneNumber: spec.phoneNumber,
          role: spec.role,
          isActive: true,
          isDemo: true,
          termsAcceptedAt: new Date(),
        })
        .returning({ id: users.id });
      userId = inserted.id;
    }

    await db
      .insert(userProfiles)
      .values({
        userId,
        communityArea: spec.communityArea,
      })
      .onConflictDoNothing({ target: userProfiles.userId });

    await db
      .insert(rewardWallets)
      .values({
        userId,
        availablePoints: '0.00',
        totalEarnedPoints: '0.00',
        totalRedeemedPoints: '0.00',
        pendingRedemptionPoints: '0.00',
      })
      .onConflictDoNothing({ target: rewardWallets.userId });

    if (spec.role === 'AGENT') {
      await db
        .insert(collectionAgentProfiles)
        .values({
          userId,
          serviceZone: spec.serviceZone ?? 'FUTO & Ihiagwa',
          isAvailable: true,
        })
        .onConflictDoNothing({ target: collectionAgentProfiles.userId });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoAccounts()
    .then(() => {
      console.log('Seeded KILN demo accounts (admin@kiln.demo, agent@kiln.demo, student@kiln.demo).');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed demo accounts:', err);
      process.exit(1);
    });
}
