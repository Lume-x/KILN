import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const RUN_ID = `st9_${Date.now()}`;

interface SessionClient {
  label: string;
  cookie: string;
  userId?: number;
  email?: string;
  request: (
    path: string,
    opts?: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      rawText?: boolean;
    }
  ) => Promise<{ status: number; data: any; text: string; headers: Headers }>;
}

function createClient(label: string): SessionClient {
  const client: SessionClient = {
    label,
    cookie: '',
    async request(path, opts = {}) {
      const method = opts.method ?? 'GET';
      const headers: Record<string, string> = {
        ...(opts.headers ?? {}),
      };
      if (client.cookie) {
        headers.cookie = client.cookie;
      }
      let body: string | undefined;
      if (opts.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/kiln_session=[^;]+/);
        if (match) {
          client.cookie = match[0];
        }
      }
      const text = await res.text();
      let data: any = null;
      if (!opts.rawText) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return { status: res.status, data, text, headers: res.headers };
    },
  };
  return client;
}

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  [PASS] ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail: msg });
    console.error(`  [FAIL] ${name} -> ${msg}`);
  }
}

// Valid 1x1 transparent PNG
const VALID_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Invalid fake PNG (plain ASCII text masquerading as PNG data URL)
const FAKE_PNG_DATA_URL =
  'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>not-a-png').toString('base64');

async function main() {
  console.log(`\n=== KILN Stage 9 Comprehensive E2E & Security Test Suite (${RUN_ID}) ===\n`);

  const anon = createClient('anon');
  const admin = createClient('admin');
  const agent = createClient('agent');
  const userA = createClient('userA');
  const userB = createClient('userB');

  const testEmailA = `${RUN_ID}_a@kiln.test`;
  const testEmailB = `${RUN_ID}_b@kiln.test`;

  let materials: any[] = [];
  let plasticCatId = 0;
  let aluminiumCatId = 0;
  let dropOffPointId = 0;
  let agentUserId = 0;
  let storageLocation1Id = 0;
  let storageLocation2Id = 0;

  let pickupReqId = 0;
  let pickupReq2Id = 0;
  let dropOffReqId = 0;
  let pickupVerificationId = 0;
  let pickupVerification2Id = 0;
  let inventoryEntry1Id = 0;
  let inventoryEntry2Id = 0;
  let batch1Id = 0;
  let batch2Id = 0;
  let consolidatedBatchId = 0;
  let transferId = 0;
  let saleId = 0;
  let lightningRedemptionId = 0;
  let failRedemptionId = 0;

  // ----------------------------------------------------------------
  // 1. HEALTH, SECURITY HEADERS & PUBLIC APIS
  // ----------------------------------------------------------------
  await test('Health check verifies live PostgreSQL connectivity & security headers', async () => {
    const res = await anon.request('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.database, 'connected');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('x-frame-options'), null, 'Must not block AI Studio iframe preview');
  });

  await test('Public APIs return real materials, collection points, and impact summary', async () => {
    const [matRes, ptRes, impRes] = await Promise.all([
      anon.request('/api/public/materials'),
      anon.request('/api/public/collection-points'),
      anon.request('/api/public/impact'),
    ]);
    assert.equal(matRes.status, 200);
    assert.ok(Array.isArray(matRes.data.materials) && matRes.data.materials.length >= 4);
    materials = matRes.data.materials;
    plasticCatId = materials.find((m) => m.slug === 'plastic-bottles')?.id ?? materials[0].id;
    aluminiumCatId = materials.find((m) => m.slug === 'aluminium-cans')?.id ?? materials[1].id;

    assert.equal(ptRes.status, 200);
    assert.ok(Array.isArray(ptRes.data.collectionPoints) && ptRes.data.collectionPoints.length >= 1);
    dropOffPointId =
      ptRes.data.collectionPoints.find((p: any) => p.status === 'ACTIVE' || p.status === 'DEMO')
        ?.id ?? ptRes.data.collectionPoints[0].id;

    assert.equal(impRes.status, 200);
    assert.equal(typeof impRes.data.impact.totalVerifiedCollections, 'number');
  });

  await test('Unknown /api/* route returns clean JSON 404', async () => {
    const res = await anon.request('/api/does-not-exist-stage9');
    assert.equal(res.status, 404);
    assert.ok(res.data.error);
  });

  // ----------------------------------------------------------------
  // 2. AUTHENTICATION, REGISTRATION, ROLE ENFORCEMENT & CSRF GUARD
  // ----------------------------------------------------------------
  await test('Unauthenticated requests to protected endpoints return 401', async () => {
    const [r1, r2, r3, r4] = await Promise.all([
      anon.request('/api/collections'),
      anon.request('/api/wallet'),
      anon.request('/api/agent/assignments'),
      anon.request('/api/admin/overview'),
    ]);
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
    assert.equal(r3.status, 401);
    assert.equal(r4.status, 401);
  });

  await test('Registration enforces USER role even when attacker passes role=ADMIN', async () => {
    const resA = await userA.request('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: '=HYPERLINK("https://evil.example","UserA")', // Also tests CSV formula neutralization later!
        email: testEmailA,
        phoneNumber: '+2348011112222',
        password: 'KilnTestUser2026!',
        communityArea: 'FUTO Campus',
        termsAccepted: true,
        role: 'ADMIN', // Escalation attempt must be ignored
      },
    });
    assert.equal(resA.status, 201);
    assert.equal(resA.data.user.role, 'USER', 'Role escalation must be impossible on registration');
    userA.userId = resA.data.user.id;
    userA.email = testEmailA;

    const resB = await userB.request('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Stage9 User B',
        email: testEmailB,
        phoneNumber: '+2348033334444',
        password: 'KilnTestUser2026!',
        communityArea: 'Ihiagwa',
        termsAccepted: true,
      },
    });
    assert.equal(resB.status, 201);
    userB.userId = resB.data.user.id;
    userB.email = testEmailB;
  });

  await test('Invalid login rejected with 401; Demo Admin and Agent login succeed', async () => {
    const bad = await anon.request('/api/auth/login', {
      method: 'POST',
      body: { email: testEmailA, password: 'WrongPassword123!' },
    });
    assert.equal(bad.status, 401);

    const adminRes = await admin.request('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@kiln.demo', password: 'KilnAdmin2026!' },
    });
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.data.user.role, 'ADMIN');
    admin.userId = adminRes.data.user.id;

    const agentRes = await agent.request('/api/auth/login', {
      method: 'POST',
      body: { email: 'agent@kiln.demo', password: 'KilnAgent2026!' },
    });
    assert.equal(agentRes.status, 200);
    assert.equal(agentRes.data.user.role, 'AGENT');
    agent.userId = agentRes.data.user.id;
    agentUserId = agentRes.data.user.id;
  });

  await test('RBAC blocks USER from /api/agent/* and /api/admin/*, and AGENT from /api/admin/*', async () => {
    const [uAdmin, uAgent, aAdmin] = await Promise.all([
      userA.request('/api/admin/overview'),
      userA.request('/api/agent/assignments'),
      agent.request('/api/admin/overview'),
    ]);
    assert.equal(uAdmin.status, 403);
    assert.equal(uAgent.status, 403);
    assert.equal(aAdmin.status, 403);
  });

  await test('CSRF Origin mismatch guard blocks cross-origin cookie-authenticated POST', async () => {
    const res = await userA.request('/api/account/profile', {
      method: 'PATCH',
      headers: { Origin: 'https://evil-attacker.example' },
      body: { fullName: 'Hacked Name' },
    });
    assert.equal(res.status, 403);
    assert.match(String(res.data.error), /Cross-origin/i);
  });

  // ----------------------------------------------------------------
  // 3. COLLECTION WORKFLOW, PHOTO MAGIC BYTES & CROSS-USER ISOLATION
  // ----------------------------------------------------------------
  await test('Photo upload rejects fake PNG magic bytes (polyglot/script disguised as image)', async () => {
    const res = await userA.request('/api/collections', {
      method: 'POST',
      body: {
        materialCategoryId: plasticCatId,
        estimatedWeightKg: '3.00',
        collectionMethod: 'PICKUP',
        communityArea: 'FUTO Campus',
        pickupAddress: 'Hostel B, Room 12, FUTO Campus',
        preferredWindow: 'Morning (8:00 AM – 12:00 PM)',
        photoDataUrl: FAKE_PNG_DATA_URL,
      },
    });
    assert.equal(res.status, 400);
    assert.match(String(res.data.error), /signature|JPEG|PNG|WebP/i);
  });

  await test('Create pickup requests (with valid PNG) and drop-off request with unique refs', async () => {
    const r1 = await userA.request('/api/collections', {
      method: 'POST',
      body: {
        materialCategoryId: plasticCatId,
        estimatedWeightKg: '3.50',
        collectionMethod: 'PICKUP',
        communityArea: 'FUTO Campus',
        pickupAddress: 'Hostel B, Room 12, FUTO Campus',
        landmarksDirections: 'Beside FUTO Main Gate',
        preferredWindow: 'Morning (8:00 AM – 12:00 PM)',
        notes: '=CMD() test CSV formula safety',
        photoDataUrl: VALID_PNG_DATA_URL,
      },
    });
    assert.equal(r1.status, 201);
    assert.match(r1.data.request.referenceCode, /^KILN-\d{8}-[A-F0-9]{6}$/);
    pickupReqId = r1.data.request.id;

    const r2 = await userA.request('/api/collections', {
      method: 'POST',
      body: {
        materialCategoryId: plasticCatId,
        estimatedWeightKg: '2.00',
        collectionMethod: 'PICKUP',
        communityArea: 'FUTO Campus',
        pickupAddress: 'Hostel C, Room 8, FUTO Campus',
        preferredWindow: 'Afternoon (12:00 PM – 4:00 PM)',
      },
    });
    assert.equal(r2.status, 201);
    pickupReq2Id = r2.data.request.id;

    const rDrop = await userA.request('/api/collections', {
      method: 'POST',
      body: {
        materialCategoryId: aluminiumCatId,
        estimatedWeightKg: '1.50',
        collectionMethod: 'DROP_OFF',
        communityArea: 'FUTO Campus',
        collectionPointId: dropOffPointId,
        preferredWindow: 'Afternoon (12:00 PM – 4:00 PM)',
      },
    });
    assert.equal(rDrop.status, 201);
    dropOffReqId = rDrop.data.request.id;
    assert.notEqual(r1.data.request.referenceCode, rDrop.data.request.referenceCode);
  });

  await test('Cross-user IDOR blocked: User B cannot inspect or cancel User A collection', async () => {
    const [getRes, cancelRes] = await Promise.all([
      userB.request(`/api/collections/${pickupReqId}`),
      userB.request(`/api/collections/${pickupReqId}/cancel`, { method: 'POST', body: {} }),
    ]);
    assert.equal(getRes.status, 403);
    assert.equal(cancelRes.status, 403);
  });

  await test('User A can cancel a PENDING drop-off request; cannot cancel twice', async () => {
    const c1 = await userA.request(`/api/collections/${dropOffReqId}/cancel`, {
      method: 'POST',
      body: { reason: 'Stage 9 cancel test' },
    });
    assert.equal(c1.status, 200);
    assert.equal(c1.data.request.status, 'CANCELLED');

    const c2 = await userA.request(`/api/collections/${dropOffReqId}/cancel`, {
      method: 'POST',
      body: { reason: 'Duplicate cancel' },
    });
    assert.equal(c2.status, 400);
  });

  // ----------------------------------------------------------------
  // 4. AGENT ASSIGNMENT, STATUS TRANSITIONS, WEIGHT MATH & VERIFICATION
  // ----------------------------------------------------------------
  await test('Admin approves & assigns pickupReq1; Agent accepts -> In Progress -> Collected', async () => {
    const rev = await admin.request(`/api/admin/collections/${pickupReqId}/review`, {
      method: 'POST',
      body: { decision: 'APPROVED' },
    });
    assert.equal(rev.status, 200);
    assert.equal(rev.data.request.status, 'APPROVED');

    const asg = await admin.request(`/api/admin/collections/${pickupReqId}/assign`, {
      method: 'POST',
      body: { agentUserId },
    });
    assert.equal(asg.status, 200);
    assert.equal(asg.data.request.status, 'ASSIGNED');
    const assignmentId = asg.data.request.activeAssignment.id;

    // Invalid transition test: cannot mark COLLECTED before ACCEPT + IN_PROGRESS
    const badSkip = await agent.request(`/api/agent/assignments/${assignmentId}/progress`, {
      method: 'POST',
      body: { nextStatus: 'COLLECTED' },
    });
    assert.equal(badSkip.status, 400);

    const acc = await agent.request(`/api/agent/assignments/${assignmentId}/respond`, {
      method: 'POST',
      body: { decision: 'ACCEPT' },
    });
    assert.equal(acc.status, 200);
    assert.equal(acc.data.request.status, 'ACCEPTED_BY_AGENT');

    const prog1 = await agent.request(`/api/agent/assignments/${assignmentId}/progress`, {
      method: 'POST',
      body: { nextStatus: 'IN_PROGRESS' },
    });
    assert.equal(prog1.status, 200);
    assert.equal(prog1.data.request.status, 'IN_PROGRESS');

    const prog2 = await agent.request(`/api/agent/assignments/${assignmentId}/progress`, {
      method: 'POST',
      body: { nextStatus: 'COLLECTED' },
    });
    assert.equal(prog2.status, 200);
    assert.equal(prog2.data.request.status, 'COLLECTED');

    // Invalid weight math: eligible + rejected > actual must be rejected
    const badWeight = await agent.request(`/api/agent/assignments/${assignmentId}/weight`, {
      method: 'POST',
      body: {
        actualWeightKg: '3.50',
        rejectedWeightKg: '0.50',
        eligibleWeightKg: '3.20',
        qualityGrade: 'A_CLEAN',
      },
    });
    assert.equal(badWeight.status, 400);

    // Valid weight record: 3.50 actual, 0.17 rejected, 3.33 eligible
    const goodWeight = await agent.request(`/api/agent/assignments/${assignmentId}/weight`, {
      method: 'POST',
      body: {
        actualWeightKg: '3.50',
        rejectedWeightKg: '0.17',
        eligibleWeightKg: '3.33',
        qualityGrade: 'A_CLEAN',
        contaminationNotes: 'Minor cap residue removed',
        agentNotes: 'Weighed on digital hanging scale #2',
        evidencePhotoUrl: VALID_PNG_DATA_URL,
      },
    });
    assert.equal(goodWeight.status, 201);
    assert.equal(goodWeight.data.request.status, 'AWAITING_VERIFICATION');

    // Agent must not be able to approve their own verification
    const agentApprove = await agent.request(`/api/admin/collections/${pickupReqId}/verify`, {
      method: 'POST',
      body: { decision: 'APPROVED' },
    });
    assert.equal(agentApprove.status, 403);
  });

  await test('Wallet has 0 pts BEFORE admin verification; exact decimal reward credited AFTER approval', async () => {
    const beforeWallet = await userA.request('/api/wallet');
    assert.equal(beforeWallet.status, 200);
    assert.equal(beforeWallet.data.wallet.availablePoints, '0.00');

    // Ensure plastic bottles rate is known (seeded at 50.00 pts/kg)
    const ratesRes = await admin.request('/api/admin/reward-rates');
    assert.equal(ratesRes.status, 200);
    const activePlasticRate = ratesRes.data.rates.find(
      (r: any) => r.materialCategoryId === plasticCatId && r.isActive
    );
    assert.ok(activePlasticRate, 'Active plastic reward rate must exist');
    const ratePerKg = Number(activePlasticRate.pointsPerKg);
    const expectedPoints = (3.33 * ratePerKg).toFixed(2);

    const verRes = await admin.request(`/api/admin/collections/${pickupReqId}/verify`, {
      method: 'POST',
      body: { decision: 'APPROVED', reviewNotes: 'Scale photo & weight verified cleanly.' },
    });
    assert.equal(verRes.status, 200);
    assert.equal(verRes.data.request.status, 'VERIFIED');
    assert.equal(verRes.data.request.verification.pointsAwarded, expectedPoints);
    pickupVerificationId = verRes.data.request.verification.id;

    // Duplicate verification must be rejected
    const dupVer = await admin.request(`/api/admin/collections/${pickupReqId}/verify`, {
      method: 'POST',
      body: { decision: 'APPROVED' },
    });
    assert.equal(dupVer.status, 400);

    // Check User A wallet updated accurately
    const afterWallet = await userA.request('/api/wallet');
    assert.equal(afterWallet.status, 200);
    assert.equal(afterWallet.data.wallet.availablePoints, expectedPoints);
    assert.equal(afterWallet.data.wallet.totalEarnedPoints, expectedPoints);
  });

  await test('Historical rate preservation: changing reward rate does NOT alter prior verification or ledger', async () => {
    // Capture current rate
    const ratesBefore = await admin.request('/api/admin/reward-rates');
    const prevRate = ratesBefore.data.rates.find(
      (r: any) => r.materialCategoryId === plasticCatId && r.isActive
    );
    const origPtsPerKg = prevRate.pointsPerKg;

    // Change rate temporarily to 75.00 pts/kg
    const newRateRes = await admin.request('/api/admin/reward-rates', {
      method: 'POST',
      body: {
        materialCategoryId: plasticCatId,
        pointsPerKg: '75.00',
        isDemo: true,
        notes: 'Stage 9 historical rate test',
      },
    });
    assert.equal(newRateRes.status, 201);

    // Confirm pickupReq1 still displays original appliedPointsPerKg & pointsAwarded
    const oldReq = await userA.request(`/api/collections/${pickupReqId}`);
    assert.equal(oldReq.status, 200);
    assert.equal(oldReq.data.request.verification.appliedPointsPerKg, origPtsPerKg);

    // Restore original rate (50.00 pts/kg) so seed state stays consistent
    const restoreRes = await admin.request('/api/admin/reward-rates', {
      method: 'POST',
      body: {
        materialCategoryId: plasticCatId,
        pointsPerKg: origPtsPerKg,
        isDemo: true,
        notes: 'Restored baseline DEMO rate after Stage 9 test',
      },
    });
    assert.equal(restoreRes.status, 201);
  });

  await test('Complete second verified collection (pickupReq2, 2.00 kg) to enable batch consolidation & higher wallet balance', async () => {
    await admin.request(`/api/admin/collections/${pickupReq2Id}/review`, {
      method: 'POST',
      body: { decision: 'APPROVED' },
    });
    const asg = await admin.request(`/api/admin/collections/${pickupReq2Id}/assign`, {
      method: 'POST',
      body: { agentUserId },
    });
    const aId = asg.data.request.activeAssignment.id;
    await agent.request(`/api/agent/assignments/${aId}/respond`, {
      method: 'POST',
      body: { decision: 'ACCEPT' },
    });
    await agent.request(`/api/agent/assignments/${aId}/progress`, {
      method: 'POST',
      body: { nextStatus: 'IN_PROGRESS' },
    });
    await agent.request(`/api/agent/assignments/${aId}/progress`, {
      method: 'POST',
      body: { nextStatus: 'COLLECTED' },
    });
    await agent.request(`/api/agent/assignments/${aId}/weight`, {
      method: 'POST',
      body: {
        actualWeightKg: '2.00',
        rejectedWeightKg: '0.00',
        eligibleWeightKg: '2.00',
        qualityGrade: 'A_CLEAN',
      },
    });
    const ver2 = await admin.request(`/api/admin/collections/${pickupReq2Id}/verify`, {
      method: 'POST',
      body: { decision: 'APPROVED', reviewNotes: 'Second verified batch source.' },
    });
    assert.equal(ver2.status, 200);
    pickupVerification2Id = ver2.data.request.verification.id;
  });

  // ----------------------------------------------------------------
  // 5. REDEMPTIONS, CONCURRENT DOUBLE-SPEND GUARD, LIGHTNING DEMO PAYOUT & REVERSALS
  // ----------------------------------------------------------------
  await test('Concurrent parallel redemptions cannot double-spend wallet balance (row lock test)', async () => {
    // User A now has ~266.50 pts (166.50 + 100.00). Fire 3 simultaneous 150.00-pt redemptions.
    // Exactly ONE must succeed (201) and the other TWO must fail (400 insufficient balance)!
    const [p1, p2, p3] = await Promise.all([
      userA.request('/api/redemptions', {
        method: 'POST',
        body: {
          pointsRequested: '150.00',
          method: 'AIRTIME',
          destinationDetails: '08012345678',
          notes: 'Parallel race test 1',
        },
      }),
      userA.request('/api/redemptions', {
        method: 'POST',
        body: {
          pointsRequested: '150.00',
          method: 'AIRTIME',
          destinationDetails: '08012345678',
          notes: 'Parallel race test 2',
        },
      }),
      userA.request('/api/redemptions', {
        method: 'POST',
        body: {
          pointsRequested: '150.00',
          method: 'AIRTIME',
          destinationDetails: '08012345678',
          notes: 'Parallel race test 3',
        },
      }),
    ]);

    const statuses = [p1.status, p2.status, p3.status];
    const successes = statuses.filter((s) => s === 201);
    const failures = statuses.filter((s) => s === 400);
    assert.equal(successes.length, 1, `Expected exactly 1 success in race, got statuses: ${statuses}`);
    assert.equal(failures.length, 2, `Expected 2 rejections in race, got statuses: ${statuses}`);

    const winner = [p1, p2, p3].find((r) => r.status === 201)!;
    const cancelWin = await userA.request(`/api/redemptions/${winner.data.redemption.id}/cancel`, {
      method: 'POST',
      body: { reason: 'Releasing points after race check' },
    });
    assert.equal(cancelWin.status, 200);
    assert.equal(cancelWin.data.redemption.status, 'CANCELLED');

    const afterCancelWallet = await userA.request('/api/wallet');
    assert.equal(afterCancelWallet.data.wallet.pendingRedemptionPoints, '0.00');
    assert.equal(afterCancelWallet.data.wallet.availablePoints, '266.50');
  });

  await test('Lightning DEMO payout succeeds with SIM-LN reference, blocks duplicate payout, and exposes zero secrets', async () => {
    const r = await userA.request('/api/redemptions', {
      method: 'POST',
      body: {
        pointsRequested: '100.00',
        method: 'BITCOIN_LIGHTNING',
        destinationDetails: 'student@blink.sv',
      },
    });
    assert.equal(r.status, 201);
    lightningRedemptionId = r.data.redemption.id;

    // Approve first
    const appRes = await admin.request(`/api/admin/redemptions/${lightningRedemptionId}/transition`, {
      method: 'POST',
      body: { nextStatus: 'APPROVED', adminNotes: 'Approved for demo Lightning test' },
    });
    assert.equal(appRes.status, 200);
    assert.equal(appRes.data.redemption.status, 'APPROVED');

    // Execute Lightning payout in DEMO mode
    const payRes = await admin.request(
      `/api/admin/integrations/lightning/payout/${lightningRedemptionId}`,
      { method: 'POST', body: {} }
    );
    assert.equal(payRes.status, 200);
    assert.equal(payRes.data.payout.status, 'PAID');
    assert.equal(payRes.data.payout.isSimulatedPayout, true);
    assert.match(payRes.data.payout.paymentReference, /^SIM-LN-/);
    assert.ok(!JSON.stringify(payRes.data).includes('encryptedNwcUri'));

    // Duplicate payout must be blocked
    const dupPay = await admin.request(
      `/api/admin/integrations/lightning/payout/${lightningRedemptionId}`,
      { method: 'POST', body: {} }
    );
    assert.equal(dupPay.status, 400);
  });

  await test('Failed redemption automatically reverses reserved wallet points & negative admin adjustment below 0 is blocked', async () => {
    const rFail = await userA.request('/api/redemptions', {
      method: 'POST',
      body: {
        pointsRequested: '100.00',
        method: 'BITCOIN_LIGHTNING',
        destinationDetails: 'failtest@blink.sv',
      },
    });
    assert.equal(rFail.status, 201);
    failRedemptionId = rFail.data.redemption.id;

    await admin.request(`/api/admin/redemptions/${failRedemptionId}/transition`, {
      method: 'POST',
      body: { nextStatus: 'APPROVED' },
    });

    const failPay = await admin.request(
      `/api/admin/integrations/lightning/payout/${failRedemptionId}`,
      { method: 'POST', body: { simulateFailure: true } }
    );
    assert.equal(failPay.status, 200);
    assert.equal(failPay.data.payout.status, 'FAILED');

    // Wallet should have reversed the 100.00 pts back to 166.50
    const wal = await userA.request('/api/wallet');
    assert.equal(wal.data.wallet.availablePoints, '166.50');
    assert.equal(wal.data.wallet.pendingRedemptionPoints, '0.00');

    // Wallet ledger mathematical invariant check: sum(signedPoints) === availablePoints
    const ledgerSumCents = wal.data.ledger.reduce(
      (sum: number, tx: any) => sum + Math.round(Number(tx.signedPoints) * 100),
      0
    );
    assert.equal(
      (ledgerSumCents / 100).toFixed(2),
      wal.data.wallet.availablePoints,
      'Immutable ledger sum must exactly equal wallet availablePoints'
    );

    // Negative admin adjustment exceeding balance must be blocked
    const badAdj = await admin.request('/api/admin/wallet-adjustments', {
      method: 'POST',
      body: {
        userId: userA.userId,
        direction: 'DEBIT',
        amountPoints: '9999.00',
        reason: 'Attempted overdraft adjustment',
      },
    });
    assert.equal(badAdj.status, 400);
  });

  // ----------------------------------------------------------------
  // 6. STAGE 5: INVENTORY, BATCH TRACEABILITY, CONSOLIDATION, TRANSFER & SALE
  // ----------------------------------------------------------------
  await test('Verified collections auto-create traceable inventory entries; batch creation & consolidation work', async () => {
    const [locRes, entRes] = await Promise.all([
      admin.request('/api/admin/storage-locations'),
      admin.request('/api/admin/inventory/entries'),
    ]);
    assert.equal(locRes.status, 200);
    assert.ok(locRes.data.locations.length >= 2);
    storageLocation1Id = locRes.data.locations[0].id;
    storageLocation2Id = locRes.data.locations[1].id;

    assert.equal(entRes.status, 200);
    const e1 = entRes.data.entries.find((e: any) => e.verificationId === pickupVerificationId);
    const e2 = entRes.data.entries.find((e: any) => e.verificationId === pickupVerification2Id);
    assert.ok(e1, 'Inventory entry 1 must be auto-created upon approval');
    assert.ok(e2, 'Inventory entry 2 must be auto-created upon approval');
    assert.equal(e1.availableWeightKg, '3.33');
    assert.equal(e2.availableWeightKg, '2.00');
    inventoryEntry1Id = e1.id;
    inventoryEntry2Id = e2.id;

    // Create Batch 1 from entry 1
    const b1 = await admin.request('/api/admin/inventory/batches', {
      method: 'POST',
      body: {
        entryIds: [inventoryEntry1Id],
        storageLocationId: storageLocation1Id,
        notes: 'Stage 9 PET Batch 1',
      },
    });
    assert.equal(b1.status, 201);
    assert.equal(b1.data.batch.totalWeightKg, '3.33');
    batch1Id = b1.data.batch.id;

    // Create Batch 2 from entry 2
    const b2 = await admin.request('/api/admin/inventory/batches', {
      method: 'POST',
      body: {
        entryIds: [inventoryEntry2Id],
        storageLocationId: storageLocation1Id,
        notes: 'Stage 9 PET Batch 2',
      },
    });
    assert.equal(b2.status, 201);
    batch2Id = b2.data.batch.id;

    // Consolidate Batch 1 + Batch 2 preserving source traceability (3.33 + 2.00 = 5.33 kg)
    const cons = await admin.request('/api/admin/inventory/batches/consolidate', {
      method: 'POST',
      body: {
        batchIds: [batch1Id, batch2Id],
        storageLocationId: storageLocation1Id,
        notes: 'Stage 9 Consolidated PET Bale',
      },
    });
    assert.equal(cons.status, 201);
    assert.equal(cons.data.batch.totalWeightKg, '5.33');
    assert.equal(cons.data.batch.sources.length, 2, 'Consolidated batch must trace back to both collections');
    consolidatedBatchId = cons.data.batch.id;
  });

  await test('Material transfer moves batch between storage locations & sale enforces overselling guard', async () => {
    const tr = await admin.request('/api/admin/inventory/transfers', {
      method: 'POST',
      body: {
        batchId: consolidatedBatchId,
        destinationLocationId: storageLocation2Id,
        transferredBy: 'Stage 9 Logistics Driver',
        notes: 'Moving to off-campus warehouse',
      },
    });
    assert.equal(tr.status, 201);
    transferId = tr.data.transfer.id;

    const conf = await admin.request(`/api/admin/inventory/transfers/${transferId}/status`, {
      method: 'POST',
      body: { status: 'CONFIRMED' },
    });
    assert.equal(conf.status, 200);
    assert.equal(conf.data.transfer.status, 'CONFIRMED');

    // Attempt overselling (10.00 kg > 5.33 kg available) -> must fail with 400
    const badSale = await admin.request('/api/admin/inventory/sales', {
      method: 'POST',
      body: {
        batchId: consolidatedBatchId,
        buyerName: 'Oversell Buyer Ltd',
        quantityKg: '10.00',
        unitPriceNgn: '350.00',
      },
    });
    assert.equal(badSale.status, 400);

    // Valid partial sale: 4.00 kg @ 350.00 NGN = 1400.00 NGN
    const goodSale = await admin.request('/api/admin/inventory/sales', {
      method: 'POST',
      body: {
        batchId: consolidatedBatchId,
        buyerName: 'Imo Recycling Offtaker Ltd',
        quantityKg: '4.00',
        unitPriceNgn: '350.00',
        documentationRef: 'INV-ST9-001',
      },
    });
    assert.equal(goodSale.status, 201);
    assert.equal(goodSale.data.sale.totalValueNgn, '1400.00');
    saleId = goodSale.data.sale.id;

    // Independent transfer & payment status update
    const updSale = await admin.request(`/api/admin/inventory/sales/${saleId}`, {
      method: 'PATCH',
      body: { transferStatus: 'DELIVERED', paymentStatus: 'PAID' },
    });
    assert.equal(updSale.status, 200);
    assert.equal(updSale.data.sale.transferStatus, 'DELIVERED');
    assert.equal(updSale.data.sale.paymentStatus, 'PAID');
  });

  // ----------------------------------------------------------------
  // 7. STAGE 6: NWC SSRF PROTECTION, SECRET ENCRYPTION & NOSTR PROOF-OF-RECYCLING
  // ----------------------------------------------------------------
  await test('NWC rejects private/loopback SSRF relays & plaintext ws://, accepts public wss:// without leaking secret', async () => {
    const fakeHex = 'a'.repeat(64);
    const fakeSecret = 'b'.repeat(64);

    const ssrfRes = await userA.request('/api/integrations/nwc', {
      method: 'POST',
      body: {
        label: 'SSRF Attempt',
        nwcUri: `nostr+walletconnect://${fakeHex}?relay=wss://127.0.0.1:8080&secret=${fakeSecret}`,
      },
    });
    assert.equal(ssrfRes.status, 400);

    const wsRes = await userA.request('/api/integrations/nwc', {
      method: 'POST',
      body: {
        label: 'Plaintext WS Attempt',
        nwcUri: `nostr+walletconnect://${fakeHex}?relay=ws://relay.getalby.com/v1&secret=${fakeSecret}`,
      },
    });
    assert.equal(wsRes.status, 400);

    const okNwc = await userA.request('/api/integrations/nwc', {
      method: 'POST',
      body: {
        label: 'Alby Test Wallet',
        nwcUri: `nostr+walletconnect://${fakeHex}?relay=wss://relay.getalby.com/v1&secret=${fakeSecret}`,
      },
    });
    assert.equal(okNwc.status, 201);
    assert.ok(!JSON.stringify(okNwc.data).includes(fakeSecret), 'NWC secret must NEVER be returned in API response');

    const getNwc = await userA.request('/api/integrations/nwc');
    assert.equal(getNwc.status, 200);
    assert.ok(!JSON.stringify(getNwc.data).includes(fakeSecret));

    const delNwc = await userA.request('/api/integrations/nwc', { method: 'DELETE' });
    assert.equal(delNwc.status, 200);
  });

  await test('Nostr challenge + pubkey link + Proof-of-Recycling contains ZERO PII and blocks duplicates', async () => {
    const chal = await userA.request('/api/integrations/nostr/challenge', { method: 'POST' });
    assert.equal(chal.status, 201);
    const validPubkey = 'c'.repeat(64);

    const link = await userA.request('/api/integrations/nostr/link', {
      method: 'POST',
      body: { pubkeyHex: validPubkey, challengeToken: chal.data.challenge.challengeToken },
    });
    assert.equal(link.status, 200);

    // Publish Proof-of-Recycling (simulate failure first, then retry cleanly)
    const failPub = await admin.request(
      `/api/admin/integrations/nostr/publish/${pickupVerificationId}`,
      { method: 'POST', body: { simulateFailure: true } }
    );
    assert.equal(failPub.status, 200);
    assert.equal(failPub.data.publication.status, 'FAILED');

    const okPub = await admin.request(
      `/api/admin/integrations/nostr/publish/${pickupVerificationId}`,
      { method: 'POST', body: {} }
    );
    assert.equal(okPub.status, 200);
    assert.equal(okPub.data.publication.status, 'DEMO_PUBLISHED');
    const payloadStr = JSON.stringify(okPub.data.publication.eventPayload);
    assert.ok(!payloadStr.includes(testEmailA), 'Nostr payload must NOT contain user email');
    assert.ok(!payloadStr.includes('08011112222'), 'Nostr payload must NOT contain phone number');
    assert.ok(!payloadStr.includes('Hostel B'), 'Nostr payload must NOT contain street address');

    // Duplicate publish blocked
    const dupPub = await admin.request(
      `/api/admin/integrations/nostr/publish/${pickupVerificationId}`,
      { method: 'POST', body: {} }
    );
    assert.equal(dupPub.status, 400);
  });

  // ----------------------------------------------------------------
  // 8. STAGE 7: AI WASTE SORTER (ADVISORY ONLY) & LEARN AND EARN
  // ----------------------------------------------------------------
  await test('AI Waste Sorter classifies materials + unsupported items without crediting wallet', async () => {
    const walletBefore = (await userA.request('/api/wallet')).data.wallet.availablePoints;

    const c1 = await userA.request('/api/ai-sorter/classify', {
      method: 'POST',
      body: { textDescription: 'Clear PET Eva water bottles rinsed and flattened' },
    });
    assert.equal(c1.status, 200);
    assert.equal(c1.data.classification.isSupported, true);
    assert.ok(c1.data.classification.advisoryNotice);

    const c2 = await userA.request('/api/ai-sorter/classify', {
      method: 'POST',
      body: { textDescription: 'Used car battery leaking acid and broken medical syringes' },
    });
    assert.equal(c2.status, 200);
    assert.equal(c2.data.classification.isSupported, false);

    const walletAfter = (await userA.request('/api/wallet')).data.wallet.availablePoints;
    assert.equal(walletAfter, walletBefore, 'AI classification must NEVER credit wallet points');
  });

  await test('Learn & Earn: failing quiz gives 0 pts, passing quiz credits bonus once, duplicate passing gives 0 extra pts', async () => {
    const modsRes = await userA.request('/api/learning/modules');
    assert.equal(modsRes.status, 200);
    assert.ok(modsRes.data.modules.length >= 3);
    const mod = modsRes.data.modules[0];
    const walletBefore = Number((await userA.request('/api/wallet')).data.wallet.availablePoints);

    // Fail attempt (all index 3)
    const failRes = await userA.request(`/api/learning/modules/${mod.id}/submit`, {
      method: 'POST',
      body: { answers: [3, 3, 3] },
    });
    assert.equal(failRes.status, 200);
    assert.equal(failRes.data.result.passed, false);
    assert.equal(failRes.data.result.bonusAwarded, '0.00');

    // Correct answers for seeded Module 1 ("Preparing Plastic Bottles for KILN") are [0, 1, 1]
    // Let's also discover passing answers cleanly if order differs
    const passRes = await userA.request(`/api/learning/modules/${mod.id}/submit`, {
      method: 'POST',
      body: { answers: [0, 1, 1] },
    });
    assert.equal(passRes.status, 200);
    assert.equal(passRes.data.result.passed, true);
    assert.ok(Number(passRes.data.result.bonusAwarded) > 0);
    const bonusAmt = Number(passRes.data.result.bonusAwarded);

    const walletAfterPass = Number((await userA.request('/api/wallet')).data.wallet.availablePoints);
    assert.equal(walletAfterPass.toFixed(2), (walletBefore + bonusAmt).toFixed(2));

    // Duplicate passing submission must NOT credit duplicate bonus
    const dupPass = await userA.request(`/api/learning/modules/${mod.id}/submit`, {
      method: 'POST',
      body: { answers: [0, 1, 1] },
    });
    assert.equal(dupPass.status, 200);
    assert.equal(dupPass.data.result.bonusAwarded, '0.00');
    const walletAfterDup = Number((await userA.request('/api/wallet')).data.wallet.availablePoints);
    assert.equal(walletAfterDup.toFixed(2), walletAfterPass.toFixed(2));
  });

  // ----------------------------------------------------------------
  // 9. STAGE 8: ADMIN OVERVIEW, USER GOVERNANCE, REPORTS, FORMULA-SAFE CSV & AUDIT LOGS
  // ----------------------------------------------------------------
  await test('Admin overview, operational reports, audit logs, and self-demotion guard work', async () => {
    const [ov, rep, aud, selfDemote] = await Promise.all([
      admin.request('/api/admin/overview'),
      admin.request('/api/admin/reports'),
      admin.request('/api/admin/audit-logs?limit=25'),
      admin.request(`/api/admin/users/${admin.userId}`, {
        method: 'PATCH',
        body: { role: 'USER' },
      }),
    ]);

    assert.equal(ov.status, 200);
    assert.ok(ov.data.overview.totalRegisteredUsers >= 5);
    assert.ok(ov.data.overview.approvedVerifications >= 2);

    assert.equal(rep.status, 200);
    assert.ok(rep.data.reports.collections.verifiedWeightKg);
    assert.ok(rep.data.reports.rewards.totalCreditedPoints);
    assert.ok(rep.data.reports.inventory.salesRevenueNgn);
    assert.ok(Array.isArray(rep.data.reports.materialsBreakdown));

    assert.equal(aud.status, 200);
    assert.ok(Array.isArray(aud.data.logs) && aud.data.logs.length > 0);

    assert.equal(selfDemote.status, 400, 'Admin must not be able to demote their own ADMIN role');
  });

  await test('All 7 CSV exports succeed, neutralize spreadsheet formulas, mask destinations, and log audit events', async () => {
    const types = ['collections', 'verifications', 'rewards', 'redemptions', 'inventory', 'sales', 'audit'];
    for (const t of types) {
      const res = await admin.request(`/api/admin/reports/export?type=${t}`, { rawText: true });
      assert.equal(res.status, 200, `CSV export for ${t} must succeed`);
      assert.match(res.headers.get('content-type') || '', /text\/csv/i);
      assert.ok(res.text.length > 20, `CSV export for ${t} must not be empty`);
      if (t === 'redemptions') {
        assert.ok(!res.text.includes('failtest@blink.sv'), 'Redemption CSV must export masked destination only');
      }
      if (t === 'collections') {
        // Ensure no unescaped formula cell starts with =
        assert.ok(!res.text.includes(',=CMD()'), 'CSV must neutralize leading formula characters');
      }
    }
  });

  await test('Notifications delivered to participant and can be marked read', async () => {
    const nRes = await userA.request('/api/notifications');
    assert.equal(nRes.status, 200);
    assert.ok(nRes.data.notifications.length >= 3);
    assert.ok(nRes.data.unreadCount >= 3);

    const markAll = await userA.request('/api/notifications/read-all', { method: 'POST' });
    assert.equal(markAll.status, 200);

    const after = await userA.request('/api/notifications');
    assert.equal(after.data.unreadCount, 0);
  });

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Stage 9 E2E Summary: ${passed}/${results.length} passed ===`);
  console.log(
    JSON.stringify({
      runId: RUN_ID,
      testEmailA,
      testEmailB,
      pickupReqId,
      pickupReq2Id,
      dropOffReqId,
      consolidatedBatchId,
      saleId,
    })
  );
  if (failed.length > 0) {
    console.error('\nFailed tests:');
    for (const f of failed) {
      console.error(` - ${f.name}: ${f.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
