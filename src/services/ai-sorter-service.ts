import { GoogleGenAI, Type } from '@google/genai';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { aiClassifications, materialCategories } from '../db/schema.ts';
import { validateUploadedPhoto } from '../lib/collection-rules.ts';
import { ValidationError } from '../db/collection-repository.ts';
import { getIntegrationSettingsSafe } from './integrations-service.ts';

export interface ClassificationOutput {
  id: number;
  inputType: 'TEXT' | 'IMAGE' | 'IMAGE_AND_TEXT';
  suggestedCategoryId: number | null;
  suggestedCategoryName: string;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNSUPPORTED';
  isAcceptedMaterial: boolean;
  providerUsed: 'GEMINI' | 'RULE_BASED_FALLBACK';
  fallbackNotice: string | null;
  explanation: string;
  preparationGuidance: string;
  contaminationObservations: string;
  pidginSummary: string;
  advisoryDisclaimer: string;
  createdAt: Date;
}

const ADVISORY_DISCLAIMER =
  'Advisory suggestion only: AI classification does not determine reward eligibility. A KILN agent physically inspects and weighs materials, and an administrator verifies the final eligible weight.';

function runDeterministicTextFallback(
  description: string,
  hasImage: boolean,
  activeMaterials: Array<typeof materialCategories.$inferSelect>,
  reasonNote: string
): Omit<ClassificationOutput, 'id' | 'inputType' | 'createdAt' | 'advisoryDisclaimer'> {
  const lower = description.toLowerCase();

  const findMat = (slug: string) => activeMaterials.find((m) => m.slug === slug) ?? null;

  if (hasImage && description.trim().length < 3) {
    return {
      suggestedCategoryId: null,
      suggestedCategoryName: 'Manual Selection Required',
      confidenceLevel: 'LOW',
      isAcceptedMaterial: false,
      providerUsed: 'RULE_BASED_FALLBACK',
      fallbackNotice: `${reasonNote} Image inspection did not run in fallback mode; please describe the item in text or select your material category manually.`,
      explanation:
        'Automated image classification is currently unavailable. Describe the material in plain text or pick the category manually on the Collection Request form.',
      preparationGuidance:
        'Separate clean plastic bottles, aluminium cans, dry paper, and dry flattened cardboard into distinct bags before handover.',
      contaminationObservations:
        'Ensure all liquids, food residue, oil, and wet organic waste are removed prior to collection.',
      pidginSummary:
        'AI camera check no dey available right now. Abeg describe the item with text or choose the category by hand when you wan book collection.',
    };
  }

  // Deterministic rules strictly aligned with KILN's active material categories
  if (
    /\b(glass|battery|batteries|diaper|food|organic|peel|leftover|electronic|phone|wire|medical|syringe|styrofoam|nylon|sachet|pure water)\b/.test(
      lower
    )
  ) {
    return {
      suggestedCategoryId: null,
      suggestedCategoryName: 'Currently Unsupported / Non-Eligible Material',
      confidenceLevel: 'UNSUPPORTED',
      isAcceptedMaterial: false,
      providerUsed: 'RULE_BASED_FALLBACK',
      fallbackNotice: reasonNote,
      explanation:
        'The described item appears outside KILN’s currently active recyclable categories (Plastic Bottles, Aluminium Cans, Paper, and Cardboard).',
      preparationGuidance:
        'Keep unsupported, hazardous, electronic, glass, or wet organic waste strictly separate from recyclable sacks to prevent rejection.',
      contaminationObservations:
        'Mixing unsupported or wet items with accepted recyclables can cause an entire bag to be downgraded or rejected at weighing.',
      pidginSummary:
        'This item no dey inside wetin KILN dey collect for now. Keep am separate make e no spoil your clean plastic bottle, can, paper or carton.',
    };
  }

  if (/\b(pet|plastic|bottle|water bottle|soda bottle|coke bottle|eva|ragolis|fanta|pepsi)\b/.test(lower)) {
    const mat = findMat('plastic-bottles');
    const isContaminated = /\b(oil|dirty|mud|liquid|half full|juice|food)\b/.test(lower);
    return {
      suggestedCategoryId: mat?.id ?? null,
      suggestedCategoryName: mat?.name ?? 'Plastic Bottles',
      confidenceLevel: 'MEDIUM',
      isAcceptedMaterial: Boolean(mat),
      providerUsed: 'RULE_BASED_FALLBACK',
      fallbackNotice: reasonNote,
      explanation:
        'Text keywords match clean PET plastic beverage bottles, which are accepted in the FUTO & Owerri pilot.',
      preparationGuidance:
        mat?.preparationRequirements ??
        'Empty all liquids completely, rinse briefly if sticky, and crush bottles to save space.',
      contaminationObservations: isContaminated
        ? 'Your description mentions residue or liquid. Empty and drain bottles completely before handover so weight is not rejected.'
        : mat?.contaminationRules ?? 'Must be free of leftover drinks, cooking oil, chemicals, and food scraps.',
      pidginSummary:
        'E be like Plastic Bottles. Pour out all water or drink inside, press am flat if you fit, and keep am clean before agent weigh am.',
    };
  }

  if (/\b(can|cans|aluminium|aluminum|tin|malt|coca cola can|energy drink|soda can|beer can)\b/.test(lower)) {
    const mat = findMat('aluminium-cans');
    return {
      suggestedCategoryId: mat?.id ?? null,
      suggestedCategoryName: mat?.name ?? 'Aluminium Cans',
      confidenceLevel: 'MEDIUM',
      isAcceptedMaterial: Boolean(mat),
      providerUsed: 'RULE_BASED_FALLBACK',
      fallbackNotice: reasonNote,
      explanation:
        'Text keywords match beverage aluminium cans, an accepted high-recovery recyclable category.',
      preparationGuidance:
        mat?.preparationRequirements ??
        'Drain all beverage residue, rinse lightly if possible, and crush cans flat.',
      contaminationObservations:
        mat?.contaminationRules ??
        'Avoid mixing steel food tins, aerosol cans, or cans containing heavy liquid or dirt.',
      pidginSummary:
        'E resemble Aluminium Cans. Pour out all remaining drink, press am small if you fit, and separate am from steel tin or nylon.',
    };
  }

  if (/\b(cardboard|carton|box|boxes|corrugated|delivery box|indomie carton|noodle carton)\b/.test(lower)) {
    const mat = findMat('cardboard');
    const isWet = /\b(wet|rain|soaked|oil|grease|pizza|stew)\b/.test(lower);
    return {
      suggestedCategoryId: mat?.id ?? null,
      suggestedCategoryName: mat?.name ?? 'Cardboard',
      confidenceLevel: isWet ? 'LOW' : 'MEDIUM',
      isAcceptedMaterial: Boolean(mat) && !isWet,
      providerUsed: 'RULE_BASED_FALLBACK',
      fallbackNotice: reasonNote,
      explanation: isWet
        ? 'Cardboard is accepted only when dry and grease-free. Wet or oil-stained cartons will likely be rejected at inspection.'
        : 'Text keywords match corrugated cardboard boxes and cartons, which are accepted when clean and dry.',
      preparationGuidance:
        mat?.preparationRequirements ?? 'Flatten all cartons neatly, keep dry, and tie into manageable bundles.',
      contaminationObservations: isWet
        ? 'Detected moisture or grease keywords. Do not submit soaked or oil-stained cardboard.'
        : mat?.contaminationRules ?? 'Must be dry and free of food grease, oil, paint, or heavy plastic wrap.',
      pidginSummary: isWet
        ? 'Carton wey oil or water don soak no go pass inspection. Keep only dry, clean carton.'
        : 'E be like Cardboard carton. Fold am flat, keep am dry, tie am well before pickup or drop-off.',
    };
  }

  if (/\b(paper|notebook|lecture|handout|book|newspaper|office paper|sheet|A4|magazine)\b/.test(lower)) {
    const mat = findMat('paper');
    const isWet = /\b(wet|soaked|oil|dirty|tissue|toilet)\b/.test(lower);
    return {
      suggestedCategoryId: mat?.id ?? null,
      suggestedCategoryName: mat?.name ?? 'Paper',
      confidenceLevel: isWet ? 'LOW' : 'MEDIUM',
      isAcceptedMaterial: Boolean(mat) && !isWet,
      providerUsed: 'RULE_BASED_FALLBACK',
      fallbackNotice: reasonNote,
      explanation: isWet
        ? 'Soiled tissue or wet/oil-stained paper cannot be recycled cleanly and is likely unsuitable.'
        : 'Text keywords match clean dry paper (lecture notes, office sheets, newspapers).',
      preparationGuidance:
        mat?.preparationRequirements ?? 'Keep paper dry, stack flat, and remove plastic folders or spiral rings.',
      contaminationObservations:
        mat?.contaminationRules ?? 'No wet paper, food-stained wrappers, carbon paper, or used tissues.',
      pidginSummary:
        'E be like Paper (note, handout, office sheet). Make sure e dry well and remove plastic file cover before submission.',
    };
  }

  return {
    suggestedCategoryId: null,
    suggestedCategoryName: 'Uncertain — Manual Review Needed',
    confidenceLevel: 'LOW',
    isAcceptedMaterial: false,
    providerUsed: 'RULE_BASED_FALLBACK',
    fallbackNotice: reasonNote,
    explanation:
      'The description did not clearly match one of KILN’s active recyclable categories. Please add more detail or select a category manually.',
    preparationGuidance:
      'KILN currently accepts clean Plastic Bottles, Aluminium Cans, dry Paper, and dry flattened Cardboard.',
    contaminationObservations:
      'Ensure items are dry, emptied of liquids, and separated from food or general waste.',
    pidginSummary:
      'We no sure which exact material this one be. Add small more details or choose from Plastic Bottles, Aluminium Cans, Paper, or Cardboard.',
  };
}

export async function classifyWasteForUser(
  userId: number,
  input: {
    textDescription?: unknown;
    imageDataUrl?: unknown;
  }
): Promise<ClassificationOutput> {
  const description =
    typeof input.textDescription === 'string' ? input.textDescription.trim().slice(0, 800) : '';
  const photoCheck = validateUploadedPhoto(input.imageDataUrl);
  if (!photoCheck.ok) {
    throw new ValidationError(photoCheck.error);
  }
  const imageDataUrl = photoCheck.value;

  if (!description && !imageDataUrl) {
    throw new ValidationError(
      'Please describe your recyclable material or upload a photograph to classify.'
    );
  }

  const inputType: 'TEXT' | 'IMAGE' | 'IMAGE_AND_TEXT' =
    imageDataUrl && description ? 'IMAGE_AND_TEXT' : imageDataUrl ? 'IMAGE' : 'TEXT';

  const [settings, activeMaterials] = await Promise.all([
    getIntegrationSettingsSafe(),
    db
      .select()
      .from(materialCategories)
      .where(and(eq(materialCategories.streamType, 'RECYCLABLE'), eq(materialCategories.isActive, true))),
  ]);

  let result: Omit<ClassificationOutput, 'id' | 'inputType' | 'createdAt' | 'advisoryDisclaimer'>;

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!settings.aiSorterEnabled) {
    result = runDeterministicTextFallback(
      description,
      Boolean(imageDataUrl),
      activeMaterials,
      'AI Waste Sorter is currently disabled by administrators — showing deterministic sorting fallback.'
    );
  } else if (!apiKey) {
    result = runDeterministicTextFallback(
      description,
      Boolean(imageDataUrl),
      activeMaterials,
      'AI provider key is not configured on this server — showing deterministic text fallback.'
    );
  } else {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const categorySpec = activeMaterials
        .map(
          (m) =>
            `- slug="${m.slug}" name="${m.name}": acceptance="${m.acceptanceInfo}"; preparation="${m.preparationRequirements}"; contamination="${m.contaminationRules}"`
        )
        .join('\n');

      const promptText = `You are KILN's advisory recycling sorter for the FUTO/Owerri pilot in Imo State, Nigeria.
Evaluate the user's item against ONLY these currently accepted KILN categories:
${categorySpec}

Rules:
1. If the item does not belong to one of these categories (e.g., glass, electronics, food waste, sachets/nylon, hazardous waste, heavily soiled waste), set suggestedSlug="UNSUPPORTED", isAcceptedMaterial=false, confidenceLevel="UNSUPPORTED".
2. If uncertain, set confidenceLevel="LOW" rather than guessing confidently.
3. Never invent new acceptance rules; base preparationGuidance and contaminationObservations on the configured rules above.
4. Provide a short, friendly Nigerian Pidgin summary in pidginSummary.
5. Keep each text field concise (1–3 sentences).

User description: ${description || '(Image submitted without text description)'}`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (imageDataUrl) {
        const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(imageDataUrl);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          });
        }
      }
      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedSlug: { type: Type.STRING },
              suggestedCategoryName: { type: Type.STRING },
              confidenceLevel: { type: Type.STRING },
              isAcceptedMaterial: { type: Type.BOOLEAN },
              explanation: { type: Type.STRING },
              preparationGuidance: { type: Type.STRING },
              contaminationObservations: { type: Type.STRING },
              pidginSummary: { type: Type.STRING },
            },
            required: [
              'suggestedSlug',
              'suggestedCategoryName',
              'confidenceLevel',
              'isAcceptedMaterial',
              'explanation',
              'preparationGuidance',
              'contaminationObservations',
              'pidginSummary',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const slug = typeof parsed.suggestedSlug === 'string' ? parsed.suggestedSlug.trim() : '';
      const matchedMat = activeMaterials.find((m) => m.slug === slug) ?? null;

      const rawConf = String(parsed.confidenceLevel ?? 'LOW').toUpperCase();
      const confidenceLevel: ClassificationOutput['confidenceLevel'] =
        rawConf === 'HIGH' || rawConf === 'MEDIUM' || rawConf === 'LOW' || rawConf === 'UNSUPPORTED'
          ? rawConf
          : 'LOW';

      result = {
        suggestedCategoryId: matchedMat?.id ?? null,
        suggestedCategoryName:
          matchedMat?.name ??
          (typeof parsed.suggestedCategoryName === 'string' && parsed.suggestedCategoryName.trim()
            ? parsed.suggestedCategoryName.trim().slice(0, 120)
            : 'Unsupported / Uncertain Material'),
        confidenceLevel,
        isAcceptedMaterial: Boolean(matchedMat) && Boolean(parsed.isAcceptedMaterial),
        providerUsed: 'GEMINI',
        fallbackNotice: null,
        explanation: String(parsed.explanation ?? 'Advisory classification completed.').slice(0, 600),
        preparationGuidance: String(
          parsed.preparationGuidance ??
            matchedMat?.preparationRequirements ??
            'Keep recyclables clean, dry, and sorted by category.'
        ).slice(0, 600),
        contaminationObservations: String(
          parsed.contaminationObservations ??
            matchedMat?.contaminationRules ??
            'Remove liquids, grease, and food waste prior to handover.'
        ).slice(0, 600),
        pidginSummary: String(
          parsed.pidginSummary ??
            'Abeg make sure your material dey clean and dry before KILN agent weigh am.'
        ).slice(0, 600),
      };
    } catch (err) {
      console.error('Gemini AI Waste Sorter call failed, engaging deterministic fallback:', err);
      result = runDeterministicTextFallback(
        description,
        Boolean(imageDataUrl),
        activeMaterials,
        'AI provider temporarily unavailable — showing deterministic sorting fallback. Collection requests remain unaffected.'
      );
    }
  }

  // Record privacy-preserving classification history (no raw photo stored)
  const inputSummary =
    description.length > 0
      ? description.slice(0, 200)
      : 'Image uploaded for advisory classification';

  const [saved] = await db
    .insert(aiClassifications)
    .values({
      userId,
      inputType,
      inputSummary,
      suggestedCategoryId: result.suggestedCategoryId,
      suggestedCategoryName: result.suggestedCategoryName,
      confidenceLevel: result.confidenceLevel,
      isAcceptedMaterial: result.isAcceptedMaterial,
      providerUsed: result.providerUsed,
      explanation: result.explanation,
      preparationGuidance: result.preparationGuidance,
      contaminationObservations: result.contaminationObservations,
      pidginSummary: result.pidginSummary,
    })
    .returning();

  return {
    id: saved.id,
    inputType,
    ...result,
    advisoryDisclaimer: ADVISORY_DISCLAIMER,
    createdAt: saved.createdAt,
  };
}

export async function listUserAiClassifications(userId: number) {
  try {
    return await db
      .select()
      .from(aiClassifications)
      .where(eq(aiClassifications.userId, userId))
      .orderBy(desc(aiClassifications.createdAt), desc(aiClassifications.id))
      .limit(20);
  } catch (error) {
    console.error('Database error in listUserAiClassifications:', error);
    throw new Error('Unable to load waste classification history.', { cause: error });
  }
}
