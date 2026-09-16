import authVisual from "@/assets/images/auth-visual.png";
import { BrandMark } from "@/components/BrandMark";

export function AuthVisual() {
  return (
    <aside className="text-accent-foreground relative isolate m-2 min-h-[680px] overflow-hidden rounded-[clamp(20px,2vw,34px)] max-[760px]:min-h-[270px]">
      <img
        alt=""
        className="absolute inset-0 z-[-2] size-full object-cover object-center"
        src={authVisual}
      />
      <div
        aria-hidden="true"
        className="from-backdrop via-backdrop/30 absolute inset-0 z-[-1] size-full bg-linear-to-r from-[0%] via-[54%] to-transparent to-[82%]"
      >
        <div className="from-backdrop size-full bg-linear-to-t from-[0%] to-transparent to-[42%]" />
      </div>

      <div className="flex min-h-full flex-col p-[clamp(30px,4.2vw,72px)] max-[980px]:p-[34px] max-[760px]:p-[26px]">
        <div className="flex items-center gap-3 text-[15px] font-[680] tracking-[-0.01em]">
          <BrandMark className="size-9" />
          <span>Инспектор ИИ</span>
        </div>

        <div className="mt-[clamp(92px,13vh,150px)] w-[min(600px,82%)] max-[980px]:w-[94%] max-[760px]:mt-11 max-[760px]:w-[90%]">
          <p className="text-accent-foreground/70 mb-5 text-xs font-[680] tracking-[0.08em] uppercase max-[760px]:hidden">
            Интеллектуальная проверка
          </p>
          <h1 className="m-0 max-w-[560px] text-[clamp(42px,4.4vw,72px)] leading-[0.98] font-[430] tracking-[-0.055em] text-balance max-[760px]:max-w-[420px] max-[760px]:text-[clamp(36px,11vw,52px)]">
            Сверяйте документы точнее
          </h1>
          <p className="text-accent-foreground/[0.76] mt-7 max-w-[490px] text-[clamp(15px,1.3vw,18px)] leading-[1.55] max-[760px]:hidden">
            Проектная, рабочая и исполнительная документация — в одном
            пространстве для камеральной проверки.
          </p>
        </div>

        <p className="text-accent-foreground/70 mt-auto text-[13px] max-[760px]:hidden">
          132 контролируемых параметра проверки
        </p>
      </div>
    </aside>
  );
}
