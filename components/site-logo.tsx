import Image from "next/image";

/** Logo singa laut + tulisan "Wagehold" untuk header. Dipakai di semua page
 *  supaya tampilannya konsisten (logo di kiri tulisan). */
export function SiteLogo() {
  return (
    <h1 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
      <Image
        src="/logo.png"
        alt=""
        width={28}
        height={28}
        priority
        className="size-7 rounded-md"
      />
      Wagehold
    </h1>
  );
}
