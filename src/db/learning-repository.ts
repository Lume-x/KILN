import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  learningCompletions,
  learningModules,
  users,
} from './schema.ts';
import {
  formatCentsToPoints,
  parsePointsToCents,
} from '../lib/rewards-rules.ts';
import { slugifyName } from '../lib/collection-rules.ts';
import { NotFoundError, ValidationError } from './collection-repository.ts';
import { creditWalletLedgerTx } from './rewards-repository.ts';
import { createNotificationTx } from './notifications-repository.ts';

export interface LearningLesson {
  title: string;
  englishBody: string;
  pidginSummary: string;
  example: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

function safeParseLessons(json: string): LearningLesson[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseQuiz(json: string): QuizQuestion[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listLearningModulesForUser(userId: number) {
  try {
    const [modules, completions] = await Promise.all([
      db
        .select()
        .from(learningModules)
        .where(eq(learningModules.isActive, true))
        .orderBy(asc(learningModules.displayOrder), asc(learningModules.id)),
      db
        .select()
        .from(learningCompletions)
        .where(eq(learningCompletions.userId, userId)),
    ]);

    const compMap = new Map(completions.map((c) => [c.moduleId, c]));

    return modules.map((m) => {
      const comp = compMap.get(m.id) ?? null;
      const lessons = safeParseLessons(m.lessonsJson);
      const questions = safeParseQuiz(m.quizQuestionsJson);
      return {
        id: m.id,
        slug: m.slug,
        title: m.title,
        summary: m.summary,
        topic: m.topic,
        passingScorePercent: m.passingScorePercent,
        bonusPoints: m.bonusPoints,
        isDemoBonus: m.isDemoBonus,
        displayOrder: m.displayOrder,
        lessons,
        // Omit correctIndex from user payload until quiz submission is graded server-side!
        quizQuestions: questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
        })),
        completion: comp
          ? {
              bestScorePercent: comp.bestScorePercent,
              attemptsCount: comp.attemptsCount,
              passed: comp.passed,
              bonusPointsAwarded: comp.bonusPointsAwarded,
              completedAt: comp.completedAt,
            }
          : null,
      };
    });
  } catch (error) {
    console.error('Database error in listLearningModulesForUser:', error);
    throw new Error('Unable to load learning modules.', { cause: error });
  }
}

/**
 * Grades a quiz attempt server-side, records completion with unique (userId, moduleId),
 * and awards configurable LEARNING_BONUS points ONCE via idempotency key.
 */
export async function submitLearningQuizAttempt(
  userId: number,
  moduleId: number,
  answersInput: unknown
) {
  if (!Array.isArray(answersInput) || answersInput.length === 0) {
    throw new ValidationError('Submit answers for all quiz questions.');
  }

  try {
    return await db.transaction(async (tx) => {
      const [mod] = await tx
        .select()
        .from(learningModules)
        .where(and(eq(learningModules.id, moduleId), eq(learningModules.isActive, true)))
        .limit(1);

      if (!mod) throw new NotFoundError('Learning module not found or inactive.');

      const questions = safeParseQuiz(mod.quizQuestionsJson);
      if (questions.length === 0) {
        throw new ValidationError('This module does not have quiz questions configured.');
      }
      if (answersInput.length !== questions.length) {
        throw new ValidationError(`Please answer all ${questions.length} quiz questions.`);
      }

      let correctCount = 0;
      const feedback = questions.map((q, idx) => {
        const chosen = Number(answersInput[idx]);
        const isCorrect = Number.isInteger(chosen) && chosen === q.correctIndex;
        if (isCorrect) correctCount += 1;
        return {
          questionId: q.id,
          question: q.question,
          chosenIndex: chosen,
          correctIndex: q.correctIndex,
          isCorrect,
          explanation: q.explanation,
        };
      });

      const scorePercent = Math.round((correctCount / questions.length) * 100);
      const passedNow = scorePercent >= mod.passingScorePercent;

      const [existingComp] = await tx
        .select()
        .from(learningCompletions)
        .where(
          and(
            eq(learningCompletions.userId, userId),
            eq(learningCompletions.moduleId, moduleId)
          )
        )
        .limit(1);

      const alreadyPassed = Boolean(existingComp?.passed);
      let bonusCreditedNow = '0.00';
      let ledgerTxId: number | null = existingComp?.ledgerTransactionId ?? null;

      if (passedNow && !alreadyPassed) {
        const bonusCents = parsePointsToCents(mod.bonusPoints) ?? 0n;
        if (bonusCents > 0n) {
          const credit = await creditWalletLedgerTx(tx, {
            userId,
            amountCents: bonusCents,
            transactionType: 'LEARNING_BONUS',
            idempotencyKey: `learning_bonus:user:${userId}:module:${moduleId}`,
            description: `Learn & Earn completion bonus${
              mod.isDemoBonus ? ' (DEMO)' : ''
            }: ${mod.title} (${scorePercent}%)`,
            actorUserId: userId,
            isDemo: mod.isDemoBonus,
            incrementTotalEarned: true,
          });
          if (credit && !credit.alreadyExisted) {
            bonusCreditedNow = mod.bonusPoints;
            ledgerTxId = credit.transaction.id;
          }
        }
      }

      const now = new Date();
      if (existingComp) {
        await tx
          .update(learningCompletions)
          .set({
            bestScorePercent: Math.max(existingComp.bestScorePercent, scorePercent),
            attemptsCount: existingComp.attemptsCount + 1,
            passed: alreadyPassed || passedNow,
            bonusPointsAwarded:
              alreadyPassed
                ? existingComp.bonusPointsAwarded
                : passedNow
                  ? bonusCreditedNow
                  : '0.00',
            ledgerTransactionId: ledgerTxId,
            completedAt:
              existingComp.completedAt ?? (passedNow ? now : null),
            updatedAt: now,
          })
          .where(eq(learningCompletions.id, existingComp.id));
      } else {
        await tx.insert(learningCompletions).values({
          userId,
          moduleId,
          bestScorePercent: scorePercent,
          attemptsCount: 1,
          passed: passedNow,
          bonusPointsAwarded: passedNow ? bonusCreditedNow : '0.00',
          ledgerTransactionId: ledgerTxId,
          completedAt: passedNow ? now : null,
        });
      }

      if (passedNow && !alreadyPassed) {
        await createNotificationTx(tx, {
          userId,
          eventType: 'LEARNING_COMPLETED',
          title: 'Learning module completed!',
          message: `You passed "${mod.title}" with ${scorePercent}%${
            bonusCreditedNow !== '0.00'
              ? ` and earned ${bonusCreditedNow} ${mod.isDemoBonus ? 'DEMO ' : ''}learning bonus points.`
              : '.'
          }`,
          actionRoute: '/learn',
          relatedType: 'LEARNING_MODULE',
          relatedId: String(moduleId),
        });

        await tx.insert(auditLogs).values({
          actorUserId: userId,
          action: 'LEARNING_MODULE_COMPLETED',
          targetType: 'LEARNING_MODULE',
          targetId: String(moduleId),
          details: `Passed "${mod.title}" (${scorePercent}%) · Bonus credited: ${bonusCreditedNow} pts`,
        });
      }

      return {
        moduleId,
        moduleTitle: mod.title,
        scorePercent,
        correctCount,
        totalQuestions: questions.length,
        passingScorePercent: mod.passingScorePercent,
        passed: passedNow,
        alreadyCompletedBefore: alreadyPassed,
        bonusPointsCreditedNow: bonusCreditedNow,
        isDemoBonus: mod.isDemoBonus,
        feedback,
      };
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in submitLearningQuizAttempt:', error);
    throw new Error('Could not grade quiz submission right now.', { cause: error });
  }
}

// ============================================================
// ADMIN LEARNING MANAGEMENT
// ============================================================

export async function listAllLearningModulesAdmin() {
  try {
    const [modules, completions, userList] = await Promise.all([
      db
        .select()
        .from(learningModules)
        .orderBy(asc(learningModules.displayOrder), asc(learningModules.id)),
      db.select().from(learningCompletions),
      db.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users),
    ]);

    const userMap = new Map(userList.map((u) => [u.id, u]));

    return modules.map((m) => {
      const modComps = completions.filter((c) => c.moduleId === m.id);
      const passedCount = modComps.filter((c) => c.passed).length;
      return {
        id: m.id,
        slug: m.slug,
        title: m.title,
        summary: m.summary,
        topic: m.topic,
        lessons: safeParseLessons(m.lessonsJson),
        quizQuestions: safeParseQuiz(m.quizQuestionsJson),
        passingScorePercent: m.passingScorePercent,
        bonusPoints: m.bonusPoints,
        isDemoBonus: m.isDemoBonus,
        isActive: m.isActive,
        displayOrder: m.displayOrder,
        attemptsTotal: modComps.reduce((sum, c) => sum + c.attemptsCount, 0),
        uniqueParticipants: modComps.length,
        passedCount,
        recentCompletions: modComps.slice(0, 10).map((c) => ({
          userId: c.userId,
          userName: userMap.get(c.userId)?.fullName ?? 'Participant',
          bestScorePercent: c.bestScorePercent,
          passed: c.passed,
          bonusPointsAwarded: c.bonusPointsAwarded,
          completedAt: c.completedAt,
        })),
      };
    });
  } catch (error) {
    console.error('Database error in listAllLearningModulesAdmin:', error);
    throw new Error('Unable to load learning modules for administration.', { cause: error });
  }
}

export async function createOrUpdateLearningModuleAdmin(
  adminId: number,
  moduleId: number | null,
  input: {
    title?: unknown;
    summary?: unknown;
    topic?: unknown;
    passingScorePercent?: unknown;
    bonusPoints?: unknown;
    isDemoBonus?: unknown;
    isActive?: unknown;
    lessons?: unknown;
    quizQuestions?: unknown;
  }
) {
  let bonusFormatted: string | undefined;
  if (input.bonusPoints !== undefined) {
    const cents = parsePointsToCents(input.bonusPoints);
    if (cents === null || cents < 0n) {
      throw new ValidationError('Learning bonus points must be 0 or a positive decimal value.');
    }
    bonusFormatted = formatCentsToPoints(cents);
  }

  let passingScore: number | undefined;
  if (input.passingScorePercent !== undefined) {
    const pct = Number(input.passingScorePercent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      throw new ValidationError('Passing score percentage must be an integer between 1 and 100.');
    }
    passingScore = pct;
  }

  try {
    if (moduleId === null) {
      if (typeof input.title !== 'string' || input.title.trim().length < 4) {
        throw new ValidationError('Module title must be at least 4 characters.');
      }
      if (typeof input.summary !== 'string' || input.summary.trim().length < 10) {
        throw new ValidationError('Module summary must be at least 10 characters.');
      }
      const title = input.title.trim().slice(0, 160);
      const summary = input.summary.trim().slice(0, 500);
      const topic =
        typeof input.topic === 'string' && input.topic.trim()
          ? input.topic.trim().slice(0, 80)
          : 'Recycling Education';

      const lessons = Array.isArray(input.lessons) && input.lessons.length > 0
        ? input.lessons
        : [
            {
              title: 'Lesson 1',
              englishBody: summary,
              pidginSummary: summary,
              example: 'Apply clean sorting before every collection.',
            },
          ];

      const quizQuestions = Array.isArray(input.quizQuestions) && input.quizQuestions.length > 0
        ? input.quizQuestions
        : [
            {
              id: 'q1',
              question: `What is the main focus of "${title}"?`,
              options: [topic, 'Unrelated topic', 'None of the above'],
              correctIndex: 0,
              explanation: `This module covers ${topic}.`,
            },
          ];

      const slug = `${slugifyName(title)}-${Date.now().toString(36).slice(-4)}`;

      const [created] = await db
        .insert(learningModules)
        .values({
          slug,
          title,
          summary,
          topic,
          lessonsJson: JSON.stringify(lessons),
          quizQuestionsJson: JSON.stringify(quizQuestions),
          passingScorePercent: passingScore ?? 67,
          bonusPoints: bonusFormatted ?? '20.00',
          isDemoBonus: typeof input.isDemoBonus === 'boolean' ? input.isDemoBonus : true,
          isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
          updatedByAdminId: adminId,
        })
        .returning();

      await db.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'LEARNING_MODULE_CREATED',
        targetType: 'LEARNING_MODULE',
        targetId: String(created.id),
        details: `Created module "${created.title}" (bonus: ${created.bonusPoints} pts)`,
      });

      return created;
    }

    const [existing] = await db
      .select()
      .from(learningModules)
      .where(eq(learningModules.id, moduleId))
      .limit(1);
    if (!existing) throw new NotFoundError('Learning module not found.');

    const updates: Partial<typeof learningModules.$inferInsert> = {
      updatedByAdminId: adminId,
      updatedAt: new Date(),
    };
    if (typeof input.title === 'string' && input.title.trim().length >= 4) {
      updates.title = input.title.trim().slice(0, 160);
    }
    if (typeof input.summary === 'string' && input.summary.trim().length >= 10) {
      updates.summary = input.summary.trim().slice(0, 500);
    }
    if (typeof input.topic === 'string' && input.topic.trim().length >= 2) {
      updates.topic = input.topic.trim().slice(0, 80);
    }
    if (passingScore !== undefined) updates.passingScorePercent = passingScore;
    if (bonusFormatted !== undefined) updates.bonusPoints = bonusFormatted;
    if (typeof input.isDemoBonus === 'boolean') updates.isDemoBonus = input.isDemoBonus;
    if (typeof input.isActive === 'boolean') updates.isActive = input.isActive;
    if (Array.isArray(input.lessons) && input.lessons.length > 0) {
      updates.lessonsJson = JSON.stringify(input.lessons);
    }
    if (Array.isArray(input.quizQuestions) && input.quizQuestions.length > 0) {
      updates.quizQuestionsJson = JSON.stringify(input.quizQuestions);
    }

    const [updated] = await db
      .update(learningModules)
      .set(updates)
      .where(eq(learningModules.id, moduleId))
      .returning();

    await db.insert(auditLogs).values({
      actorUserId: adminId,
      action: 'LEARNING_MODULE_UPDATED',
      targetType: 'LEARNING_MODULE',
      targetId: String(moduleId),
      details: `Updated module "${updated.title}" (active=${updated.isActive}, bonus=${updated.bonusPoints} pts)`,
    });

    return updated;
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
    console.error('Database error in createOrUpdateLearningModuleAdmin:', error);
    throw new Error('Could not save learning module.', { cause: error });
  }
}
