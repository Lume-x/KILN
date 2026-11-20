import { useState } from 'react';
import { Package } from 'lucide-react';
import type { MaterialCategory } from '../types/kiln';

interface MaterialCardProps {
  material: MaterialCategory;
  index: number;
}

export function MaterialCard({ material, index }: MaterialCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <article className="bg-white border border-[#DAD7CE] rounded-sm overflow-hidden flex flex-col">
      <div className="aspect-[4/3] w-full bg-[#EFECE4] overflow-hidden border-b border-[#DAD7CE]">
        {!imageError && material.imageUrl ? (
          <img
            src={material.imageUrl}
            alt={`${material.name} sorted and prepared for KILN recycling collection`}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-[#59605B]">
            <Package className="w-8 h-8 mb-2 text-[#17372D]" aria-hidden="true" />
            <span className="text-sm font-medium text-[#171B19]">{material.name}</span>
            <span className="text-xs mt-1">Accepted recyclable category</span>
          </div>
        )}
      </div>

      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-baseline justify-between gap-4 text-xs text-[#59605B] font-mono tabular-nums">
          <span>0{index + 1}. Recyclable stream</span>
          <span>Weighed in {material.unit}</span>
        </div>

        <h3 className="mt-2 font-display text-2xl font-semibold text-[#171B19] tracking-tight">
          {material.name}
        </h3>

        <p className="mt-2 text-sm leading-relaxed text-[#3F4541]">{material.description}</p>

        <dl className="mt-5 pt-5 border-t border-[#E6E3DA] space-y-3.5 text-sm flex-1">
          <div>
            <dt className="font-semibold text-[#17372D]">What is accepted</dt>
            <dd className="mt-0.5 text-[#3F4541] leading-relaxed">{material.acceptanceInfo}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#171B19]">How to prepare</dt>
            <dd className="mt-0.5 text-[#3F4541] leading-relaxed">
              {material.preparationRequirements}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[#8A4E11]">Avoid contamination</dt>
            <dd className="mt-0.5 text-[#59605B] leading-relaxed">{material.contaminationRules}</dd>
          </div>
        </dl>

        <div className="mt-5 pt-4 border-t border-[#E6E3DA] flex items-center justify-between gap-3 text-xs text-[#59605B]">
          <span>Reward credit</span>
          <span className="font-mono tabular-nums text-[#171B19]">
            {material.isRateConfigured && material.rewardRateDemo
              ? `${material.rewardRateDemo} pts / ${material.unit} (Demo rate)`
              : 'Credited after physical verification'}
          </span>
        </div>
      </div>
    </article>
  );
}
