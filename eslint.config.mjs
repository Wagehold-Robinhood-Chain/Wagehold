// eslint-config-next v16 sudah mengekspor flat config native -- tidak perlu lagi
// FlatCompat (yang justru gagal "Converting circular structure to JSON" di versi ini).
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [...coreWebVitals, ...typescript];

export default eslintConfig;
