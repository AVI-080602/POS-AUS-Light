// Cut-to-length LED strip catalogue. This is the seed/fallback list —
// the live values are stored in the `led_strip_products` setting (JSON)
// so an admin can edit rates without a deploy (Sally: "with the cost
// price of tail, could this be changed at the administrative level?").
//
// Aug 2026: replaced the original 4 generic strips with the full Havit
// per-metre range from Sally's strip sheet (165 variants; retail = RRP
// inc GST, trade = the sheet's trade price inc GST). Cut interval is
// 0.5m across the board (lengths round UP to the next 0.5m); tail rate
// follows the old convention (IP65+: $6/m, indoor: $5/m). Both are
// editable per-product under Settings → LED Strip.
export interface StripProduct {
  id: string;
  name: string;
  retailPerM: number;
  tradePerM: number;
  // Only cuttable at multiples of this many mm.
  cutMm: number;
  // Longest single continuous run (limited by voltage drop). Longer
  // orders warn the cashier but are never blocked — trade buy 100m+.
  maxRunM: number;
  // Metres of lead tail included free with each strip, and the
  // per-metre charge for anything above that.
  includedTailM: number;
  tailPerM: number;
}

export const DEFAULT_STRIP_PRODUCTS: StripProduct[] = [
  { id: 'HV9783-IP20-160-3K', name: '2W 2835 Strip Lighting - IP20 / Per Metre - 3000K', retailPerM: 15.1525, tradePerM: 10.9725, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-160-4K', name: '2W 2835 Strip Lighting - IP20 / Per Metre - 4000K', retailPerM: 15.1525, tradePerM: 10.9725, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-160-5K', name: '2W 2835 Strip Lighting - IP20 / Per Metre - 5500K', retailPerM: 15.1525, tradePerM: 10.9725, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9760-IP20-320-3K', name: 'HV9760-IP20-320-3K - 4.8w IP20 24v DC 3000K COB Dotless LED Strip  Per Metre', retailPerM: 15.1525, tradePerM: 10.9725, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9760-IP20-320-4K', name: 'HV9760-IP20-320-4K - 4.8w IP20 24v DC 4000K COB Dotless LED Strip  Per Metre', retailPerM: 15.1525, tradePerM: 10.9725, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9760-IP20-320-5K', name: 'HV9760-IP20-320-5K - 4.8w IP20 24v DC 5500K COB Dotless LED Strip  Per Metre', retailPerM: 15.1525, tradePerM: 10.9725, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9760-IP54-320-3K', name: 'HV9760-IP20-320-3K - 4.8w IP20 24v DC 3000k COB Dotless LED Strip  Per Metre', retailPerM: 21.8515, tradePerM: 15.8235, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9760-IP54-320-4K', name: 'HV9760-IP20-320-4K - 4.8w IP20 24v DC 4000k COB Dotless LED Strip  Per Metre', retailPerM: 21.8515, tradePerM: 15.8235, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9760-IP54-320-5K', name: 'HV9760-IP20-320-5K - 4.8w IP20 24v DC 5000k COB Dotless LED Strip  Per Metre - 5500K', retailPerM: 21.8515, tradePerM: 15.8235, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9760-IP67-320-3K', name: 'HV9761-IP20-320-3K - 9.6w IP20 24v DC 3000K COB Dotless LED Strip Per Metre', retailPerM: 25.2010, tradePerM: 18.2490, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9760-IP67-320-4K', name: 'HV9761-IP20-320-4K - 9.6w IP20 24v DC 4000K COB Dotless LED Strip  Per Metre', retailPerM: 25.2010, tradePerM: 18.2490, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9760-IP67-320-5K', name: 'HV9761-IP20-320-5K - 9.6w IP20 24v DC 5500K COB Dotless LED Strip  Per Metre', retailPerM: 25.2010, tradePerM: 18.2490, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP20-320-3K', name: 'HV9761-IP20-320-3K - 9.6w IP20 24v DC 3000K COB Dotless LED Strip Per Meter', retailPerM: 23.4465, tradePerM: 16.9785, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-320-4K', name: 'HV9761-IP20-320-4K - 9.6w IP20 24v DC 4000K COB Dotless LED Strip Per Meter', retailPerM: 23.4465, tradePerM: 16.9785, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-320-5K', name: 'HV9761-IP20-320-5K - 9.6w IP20 24v DC 5500K COB Dotless LED Strip Per Meter', retailPerM: 23.4465, tradePerM: 16.9785, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-320-3K', name: 'HV9761-IP54-320-3K - 9.6w IP54 24v DC 3000K COB Dotless LED Strip per meter', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-320-4K', name: 'HV9761-IP54-320-4K - 9.6w IP54 24v DC 4000K COB Dotless LED Strip per meter', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-320-5K', name: 'HV9761-IP54-320-5K - 9.6w IP54 24v DC 5500K COB Dotless LED Strip per meter', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP67-320-3K', name: 'HV9761-IP67-320-3K - 9.6w IP67 24v DC 3000K COB Dotless LED Strip per Meter', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP67-320-4K', name: 'HV9761-IP67-320-4K - 9.6w IP67 24v DC 4000K COB Dotless LED Strip Per Meter', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP67-320-5K', name: 'HV9761-IP67-320-5K - 9.6w IP67 24v DC 5500K COB Dotless LED Strip Per Meter', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9723-IP20-240-3K-1', name: 'HV9723-IP20-240-3K-1 - 19.2w IP20 LED Strip 3000k per meter', retailPerM: 46.8930, tradePerM: 33.9570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-240-4K-1', name: 'HV9723-IP20-240-4K-1 - 19.2w IP20 LED Strip 4000k per meter', retailPerM: 46.8930, tradePerM: 33.9570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-240-5K-1', name: 'HV9723-IP20-240-5K-1 - 19.2w IP20 LED Strip 5500k per meter', retailPerM: 46.8930, tradePerM: 33.9570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-240-3K-2', name: 'HV9723-IP20-240-3K-2 - 19.2w IP20 LED Strip 3000k Per Meter', retailPerM: 46.8930, tradePerM: 33.9570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-240-4K-2', name: 'HV9723-IP20-240-4K-2 - 19.2w IP20 LED Strip 4000k Per Meter', retailPerM: 46.8930, tradePerM: 33.9570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-240-5K-2', name: 'HV9723-IP20-240-5K-2 - 19.2w IP20 LED Strip 5500k Per Meter', retailPerM: 46.8930, tradePerM: 33.9570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP54-240-3K-1', name: 'HV9723-IP54-240-3K-1 - 19.2w IP54 LED Strip 3000k per Meter', retailPerM: 51.9970, tradePerM: 37.6530, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP54-240-4K-1', name: 'HV9723-IP54-240-4K-1 - 19.2w IP54 LED Strip 4000k per Meter', retailPerM: 51.9970, tradePerM: 37.6530, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP54-240-5K-1', name: 'HV9723-IP54-240-5K-1 - 19.2w IP54 LED Strip 5500k per Meter', retailPerM: 51.9970, tradePerM: 37.6530, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP67-240-3K-1', name: 'HV9723-IP67-240-3K-1 - 19.2w IP67 LED Strip 3000k per meter', retailPerM: 56.9415, tradePerM: 41.2335, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9723-IP67-240-4K-1', name: 'HV9723-IP67-240-4K-1 - 19.2w IP67 LED Strip 4000k Per Meter', retailPerM: 56.9415, tradePerM: 41.2335, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9723-IP67-240-5K-1', name: 'HV9723-IP67-240-5K-1 - 19.2w IP67 LED Strip 5500k Per Meter', retailPerM: 56.9415, tradePerM: 41.2335, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9783-IP20-120-3K', name: 'HV9783-IP20-120-3K - 24w IP20 LED Strip 3000k Per Meter', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-120-4K', name: 'HV9783-IP20-120-4K - 24w IP20 LED Strip 4000k Per Meter', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-120-5K', name: 'HV9783-IP20-120-5K - 24w IP20 LED Strip 5500k Per Meter', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-168-3K', name: 'HV9783-IP20-168-3K - 32.6w IP20 LED Strip 3000k Per Meter', retailPerM: 66.9900, tradePerM: 48.5100, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-168-4K', name: 'HV9783-IP20-168-4K - 32.6w IP20 LED Strip 4000k Per Meter', retailPerM: 66.9900, tradePerM: 48.5100, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-168-5K', name: 'HV9783-IP20-168-5K - 32.6w IP20 LED Strip 5500k 20m Roll', retailPerM: 66.9900, tradePerM: 48.5100, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-252-3K', name: 'HV9783-IP20-252-3K - 46w IP20 LED Strip 3000k Per Meter', retailPerM: 87.0870, tradePerM: 63.0630, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-252-4K', name: 'HV9783-IP20-252-4K - 46w IP20 LED Strip 4000k Per Meter', retailPerM: 87.0870, tradePerM: 63.0630, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9783-IP20-252-5K', name: 'HV9783-IP20-252-5K - 46w IP20 LED Strip 5500k Per Meter', retailPerM: 87.0870, tradePerM: 63.0630, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-320-R', name: 'HV9761-IP20-320-R - 9.6w IP20 24v DC Red COB Dotless LED Strip per Meter', retailPerM: 23.4465, tradePerM: 16.9785, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-320-R-30M', name: 'HV9761-IP20-320-R-30M - 9.6w IP20 24v DC Red COB Dotless LED Strip 30m Roll', retailPerM: 602.9100, tradePerM: 436.5900, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-320-G', name: 'HV9761-IP20-320-G - 9.6w IP20 24v DC Green COB Dotless LED Strip Per Meter', retailPerM: 23.4465, tradePerM: 16.9785, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-320-B', name: 'HV9761-IP54-320-B - 9.6w IP54 24v DC Blue COB Dotless LED Strip', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-320-Y', name: 'HV9761-IP54-320-Y - 9.6w IP54 24v DC Yellow COB Dotless LED Strip Per Meter', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-320-V', name: 'HV9761-IP54-320-V - 9.6w IP54 24v DC Violet COB Dotless LED Strip Per Meter', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP67-320-B', name: 'HV9761-IP67-320-B - 9.6w IP67 24v DC Blue COB Dotless LED Strip Per Meter', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9723-IP20-96SM-3K', name: 'HV9723-IP20-96SM-3K - 7.7w IP20 Side Mounted LED Strip 3000k per meter', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-96SM-4K', name: 'HV9723-IP20-96SM-4K - 7.7w IP20 Side Mounted LED Strip 4000k per meter', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-96SM-5K', name: 'HV9723-IP20-96SM-5K - 7.7w IP20 Side Mounted LED Strip 5500k per meter', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-96SM-R', name: 'HV9723-IP20-96SM-R - 7.7w IP20 Side Mounted LED Strip Red per Meter', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-96SM-G', name: 'HV9723-IP20-96SM-G .7w IP20 Side Mounted LED Strip Green Per Meter', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9723-IP20-96SM-B', name: 'HV9723-IP20-96SM-B .7w IP20 Side Mounted LED Strip Blue Per Meter', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-528-3K', name: 'HV9761-IP20-528-3K - 12w IP20 24v DC 3000K Free Cut COB Dotless LED Strip per Meter', retailPerM: 35.2495, tradePerM: 25.5255, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-528-4K', name: 'HV9761-IP20-528-4K - 12w IP20 24v DC 4000K Free Cut COB Dotless LED Strip per Meter', retailPerM: 35.2495, tradePerM: 25.5255, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-528-5K', name: 'HV9761-IP20-528-5K - 12w IP20 24v DC 5500K Free Cut COB Dotless LED Strip per Meter', retailPerM: 35.2495, tradePerM: 25.5255, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9753-IP20-60-RGB', name: 'HV9753-IP20-60-RGB - 11w IP20 RGB Long Run LED Strip Per Meter', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9753-IP54-60-RGB', name: 'HV9753-IP54-60-RGB - 11w IP54 RGB Long Run LED Strip Per Meter', retailPerM: 66.9900, tradePerM: 48.5100, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9753-IP67-60-RGB', name: 'HV9753-IP67-60-RGB - 11w IP67 RGB Long Run LED Strip Per Meter', retailPerM: 75.4435, tradePerM: 54.6315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9753-IP20-60-RGBW', name: 'HV9753-IP20-60-RGBW - 11w IP20 RGBW Long Run LED Strip Per Meter', retailPerM: 66.9900, tradePerM: 48.5100, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9753-IP54-60-RGBW', name: 'HV9753-IP54-60-RGBW - 11w IP54 RGBW Long Run LED Strip Per Meter', retailPerM: 75.4435, tradePerM: 54.6315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-480-RGB', name: 'HV9761-IP20-480-RGB - 15w IP20 COB RGB LED Strip per Meter', retailPerM: 30.1455, tradePerM: 21.8295, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-840-RGB', name: 'HV9761-IP20-840-RGB - 15w IP20 COB RGB LED Strip Per Meter', retailPerM: 41.9485, tradePerM: 30.3765, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-480-RGB', name: 'HV9761-IP54-480-RGB - 15w IP54 COB RGB LED Strip Per meter', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP67-480-RGB', name: 'HV9761-IP67-480-RGB - 15w IP67 COB RGB LED Strip Per Meter', retailPerM: 43.5435, tradePerM: 31.5315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP20-896-RGBC', name: 'HV9761-IP20-896-RGBC - 20w IP20 COB RGBC LED Strip Per Meter', retailPerM: 62.0455, tradePerM: 44.9295, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-896-RGBW', name: 'HV9761-IP20-896-RGBW - 20w IP20 COB RGBW LED Strip Per Meter', retailPerM: 62.0455, tradePerM: 44.9295, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-896-RGBC', name: 'HV9761-IP54-896-RGBC - 20w IP54 COB RGBC LED Strip', retailPerM: 68.7445, tradePerM: 49.7805, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-896-RGBW', name: 'HV9761-IP54-896-RGBW - 20w IP54 COB RGBW LED Strip', retailPerM: 68.7445, tradePerM: 49.7805, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP67-896-RGBC', name: 'HV9761-IP67-896-RGBC - 20w IP67 COB RGBC LED Strip', retailPerM: 72.0940, tradePerM: 52.2060, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP67-896-RGBW', name: 'HV9761-IP67-896-RGBW - 20w IP67 COB RGBW LED Strip', retailPerM: 72.0940, tradePerM: 52.2060, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP20-840-RGBCW', name: 'HV9761-IP20-840-RGBCW - 20w IP20 24v DC COB RGBCW LED Strip', retailPerM: 70.3395, tradePerM: 50.9355, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-840-RGBCW', name: 'HV9761-IP54-840-RGBCW - 20w IP54 COB RGBCW LED Strip', retailPerM: 77.0385, tradePerM: 55.7865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP67-840-RGBCW', name: 'HV9761-IP67-840-RGBCW - 20w IP67 COB RGBCW LED Strip', retailPerM: 80.3880, tradePerM: 58.2120, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP20-1152-3K', name: 'HV9761-IP20-1152-3K - 14w IP20 24v DC 3000K COB LED Strip', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-1152-4K', name: 'HV9761-IP20-1152-4K - 14w IP20 24v DC 4000K COB LED Strip', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-1280-3K', name: 'HV9761-IP20-1280-3K - 15w IP20 24v DC COB 3000K LED Strip', retailPerM: 43.5435, tradePerM: 31.5315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-1280-4K', name: 'HV9761-IP20-1280-4K - 15w IP20 24v DC COB 4000K LED Strip', retailPerM: 43.5435, tradePerM: 31.5315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-1920-3K', name: 'HV9761-IP20-1920-3K - 25w IP20 24v DC 3000K COB LED Strip Per Meter', retailPerM: 60.2910, tradePerM: 43.6590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-1920-4K', name: 'HV9761-IP20-1920-4K - 25w IP20 24v DC 4000K COB LED Strip Per Meter', retailPerM: 60.2910, tradePerM: 43.6590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-3072-3K', name: 'HV9761-IP20-3072-3K - 30w IP20 24v DC COB LED Strip 3000k Per Meter', retailPerM: 78.7930, tradePerM: 57.0570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP20-3072-4K', name: 'HV9761-IP20-3072-4K - 30w IP20 24v DC COB LED Strip 4000k Per Meter', retailPerM: 78.7930, tradePerM: 57.0570, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP20-320-3K', name: 'HV9762-IP20-320-3K - 10w IP20 24v DC 3000K CSP Dotless LED Strip Per Meter', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP20-320-4K', name: 'HV9762-IP20-320-4K - 10w IP20 24v DC 4000K CSP Dotless LED Strip Per Meter', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP20-320-5K', name: 'HV9762-IP20-320-5K - 10w IP20 24v DC 5500K CSP Dotless LED Strip Per Meter - 5000K', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP54-320-3K', name: 'HV9762-IP54-320-3K - 10w IP54 24v DC 3000K CSP Dotless LED Stripe', retailPerM: 40.1940, tradePerM: 29.1060, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP54-320-4K', name: 'HV9762-IP54-320-4K - 10w IP54 24v DC 4000K CSP Dotless LED Stripe', retailPerM: 40.1940, tradePerM: 29.1060, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP54-320-5K', name: 'HV9762-IP54-320-5K - 10w IP54 24v DC 5500K CSP Dotless LED Stripe - 5000K', retailPerM: 40.1940, tradePerM: 29.1060, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP67-320-3K', name: 'HV9762-IP67-320-3K - 10w IP67 24v DC 3000K CSP Dotless LED Strip', retailPerM: 43.5435, tradePerM: 31.5315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9762-IP67-320-4K', name: 'HV9762-IP67-320-4K - 10w IP67 24v DC 4000K CSP Dotless LED Strip', retailPerM: 43.5435, tradePerM: 31.5315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9762-IP67-320-5K', name: 'HV9762-IP67-320-5K - 10w IP67 24v DC 5500K CSP Dotless LED Strip - 5000K', retailPerM: 43.5435, tradePerM: 31.5315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9762-IP68-300-3K', name: 'HV9762-IP68-300-3K - 9.6W IP68 24v DC 300LED CSP LED Strip - 3000K', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP68-300-4K', name: 'HV9762-IP68-300-4K - 9.6W IP68 24v DC 300LED CSP LED Strip - 4000K', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP68-300-5K', name: 'HV9762-IP68-300-5K - 9.6W IP68 24v DC 300LED CSP LED Strip - 5000K', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP20-480-3K', name: 'HV9762-IP20-480-3K - 14.4w IP20 24v DC 3000K CSP Dotless LED Strip', retailPerM: 41.9485, tradePerM: 30.3765, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP20-480-4K', name: 'HV9762-IP20-480-4K - 14.4w IP20 24v DC 4000K CSP Dotless LED Strip', retailPerM: 41.9485, tradePerM: 30.3765, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP20-480-5K', name: 'HV9762-IP20-480-5K - 14.4w IP20 24v DC 5500K CSP Dotless LED Strip - 5000K', retailPerM: 41.9485, tradePerM: 30.3765, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP54-480', name: 'HV9762-IP20-480-3K - 14.4w IP20 24v DC 3000K CSP Dotless LED Strip', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP54-480-4K', name: 'HV9762-IP20-480-4K - 14.4w IP20 24v DC 4000K CSP Dotless LED Strip', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP54-480-5K', name: 'HV9762-IP20-480-5K - 14.4w IP20 24v DC 5500K CSP Dotless LED Strip - 5000K', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9762-IP67-480-3K', name: 'HV9762-IP67-480-3K - 14.4w IP67 24v DC 3000K CSP Dotless LED Strip', retailPerM: 51.9970, tradePerM: 37.6530, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9762-IP67-480-4K', name: 'HV9762-IP67-480-4K - 14.4w IP67 24v DC 4000K CSP Dotless LED Strip', retailPerM: 51.9970, tradePerM: 37.6530, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9762-IP67-480-5K', name: 'HV9762-IP67-480-5K - 14.4w IP67 24v DC 5500K CSP Dotless LED Strip - 5000K', retailPerM: 51.9970, tradePerM: 37.6530, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9722-IP20-64-3K', name: 'HV9722-IP20-64-3K - 4.8w 24v DC IP20 LED Strip 3000k', retailPerM: 26.7960, tradePerM: 19.4040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9722-IP20-64-4K', name: 'HV9722-IP20-64-4K - 4.8w 24v DC IP20 LED Strip 4000k', retailPerM: 26.7960, tradePerM: 19.4040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9722-IP20-64-5K', name: 'HV9722-IP20-64-5K - 4.8w 24v DC IP20 LED Strip 5500k', retailPerM: 26.7960, tradePerM: 19.4040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9722-IP20-128-3K', name: 'HV9722-IP20-128-3K - 9.6w 24v DC IP20 LED Strip 3000k', retailPerM: 41.9485, tradePerM: 30.3765, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9722-IP20-128-4K', name: 'HV9722-IP20-128-4K - 9.6w 24v DC IP20 LED Strip 4000k', retailPerM: 41.9485, tradePerM: 30.3765, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9722-IP20-128-5K', name: 'HV9722-IP20-128-5K - 9.6w 24v DC IP20 LED Strip 5500k', retailPerM: 41.9485, tradePerM: 30.3765, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9782-IP20-80-3K', name: 'HV9782-IP20-80-3K - 14.4w 24v DC IP20 LED Strip 3000k', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9782-IP20-80-4K', name: 'HV9782-IP20-80-3K - 14.4w 24v DC IP20 LED Strip 3000k - 4000K', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9782-IP20-80-5K', name: 'HV9782-IP20-80-3K - 14.4w 24v DC IP20 LED Strip 3000k - 5500K', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9731-IP20-180-3K', name: 'HV9731-IP20-180-3K - 4.8w IP20 Micro LED Strip 3000k', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9731-IP20-180-4K', name: 'HV9731-IP20-180-3K - 4.8w IP20 Micro LED Strip 3000k - 4000K', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9731-IP20-180-5K', name: 'HV9731-IP20-180-3K - 4.8w IP20 Micro LED Strip 3000k - 5500K', retailPerM: 28.5505, tradePerM: 20.6745, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9733-IP20-180-3K', name: 'HV9733-IP20-180-3K - 9.6w IP20 Micro LED Strip 3000k', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9733-IP20-180-4K', name: 'HV9733-IP20-180-4K - 9.6w IP20 Micro LED Strip 4000k', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9733-IP20-180-5K', name: 'HV9733-IP20-180-5K - 9.6w IP20 Micro LED Strip 5500k', retailPerM: 38.5990, tradePerM: 27.9510, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9734-IP20-240-3K', name: 'HV9734-IP20-240-3K - 14.4w IP20 Micro LED Strip 3000k', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9734-IP20-240-4K', name: 'HV9734-IP20-240-4K - 14.4w IP20 Micro LED Strip 4000k', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9734-IP20-240-5K', name: 'HV9734-IP20-240-5K - 14.4w IP20 Micro LED Strip 5500k', retailPerM: 48.6475, tradePerM: 35.2275, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9735-IP20-240-3K', name: 'HV9734-IP20-240-3K - 14.4w IP20 Micro LED Strip 3000k', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9735-IP20-240-4K', name: 'HV9734-IP20-240-4K - 14.4w IP20 Micro LED Strip 4000k', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9735-IP20-240-5K', name: 'HV9734-IP20-240-5K - 14.4w IP20 Micro LED Strip 5500k', retailPerM: 58.6960, tradePerM: 42.5040, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9768-IP67-280-3K', name: 'HV9768-IP67-280-3K - 9.6w IP67 24v DC Flexible LED Strip 3000k', retailPerM: 53.5920, tradePerM: 38.8080, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9768-IP67-280-4K', name: 'HV9768-IP67-280-4K - 9.6w IP67 24v DC Flexible LED Strip 4000k', retailPerM: 53.5920, tradePerM: 38.8080, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9768-IP67-280-5K', name: 'HV9768-IP67-280-5K - 9.6w IP67 24v DC Flexible LED Strip 5500k', retailPerM: 53.5920, tradePerM: 38.8080, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9769-IP67-280-3K', name: 'HV9769-IP67-280-3K - 14.4w IP67 24v DC Flexible LED Strip 3000k', retailPerM: 62.0455, tradePerM: 44.9295, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9769-IP67-280-4K', name: 'HV9769-IP67-280-4K - 14.4w IP67 24v DC Flexible LED Strip 4000k', retailPerM: 62.0455, tradePerM: 44.9295, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9769-IP67-280-5K', name: 'HV9769-IP67-280-5K - 14.4w IP67 24v DC Flexible LED Strip 5500k', retailPerM: 62.0455, tradePerM: 44.9295, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9761-IP20-608-CT', name: 'HV9761-IP20-608-CT - 14.4w IP20 24v DC Control Temperature COB Dotless LED Strip', retailPerM: 33.4950, tradePerM: 24.2550, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP54-608-CT', name: '4.4w IP54 24v DC Control Temperature COB Dotless LED Strip HV9761-IP54-608-CT', retailPerM: 40.1940, tradePerM: 29.1060, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9761-IP67-608-CT', name: 'HV9761-IP67-608-CT - 14.4w IP67 24v DC CT COB Dotless LED Strip', retailPerM: 43.5435, tradePerM: 31.5315, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9791-IP67-140-4K', name: 'HV9791-IP67-140-4K - 9.6w IP67 24v DC HaviFlex Side Bend Flexible Neon LED Strip 4000k', retailPerM: 63.6405, tradePerM: 46.0845, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9791-IP67-140-5K', name: 'HV9791-IP67-140-5K - 9.6w IP67 24v DC HaviFlex Side Bend Flexible Neon LED Strip 5500k', retailPerM: 63.6405, tradePerM: 46.0845, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9791-IP67-140-3K-20M', name: 'HV9791-IP67-140-3K-20M - 9.6w IP67 24v DC HaviFlex Side Bend Flexible Neon LED Strip 3000k 20m Roll', retailPerM: 1205.8200, tradePerM: 873.1800, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9792-IP67-140-3K', name: 'HV9792-IP67-140-3K - 14.4w IP67 24v DC HaviFlex Side Bend Flexible Neon LED Strip 3000k', retailPerM: 70.3395, tradePerM: 50.9355, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9792-IP67-140-4K', name: 'HV9792-IP67-140-4K - 14.4w IP67 24v DC HaviFlex Side Bend Flexible Neon LED Strip 4000k', retailPerM: 70.3395, tradePerM: 50.9355, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9792-IP67-140-5K', name: 'HV9792-IP67-140-5K - 14.4w IP67 24v DC HaviFlex Side Bend Flexible Neon LED Strip 5500k', retailPerM: 70.3395, tradePerM: 50.9355, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9792-IP67-336-RGB', name: 'HV9792-IP67-336-RGB - 14.4w IP67 24v DC HaviFlex Side Bend Flexible Neon LED Strip RGB', retailPerM: 92.1910, tradePerM: 66.7590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9795-IP67-200-3K', name: 'HV9795-IP67-200-3K - 14.4w IP67 24v DC Side Bend HaviFlex Flexible Neon LED Strip 3000k', retailPerM: 92.1910, tradePerM: 66.7590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9795-IP67-200-4K', name: 'HV9795-IP67-200-3K - 14.4w IP67 24v DC Side Bend HaviFlex Flexible Neon LED Strip 3000k - 4000K', retailPerM: 92.1910, tradePerM: 66.7590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9795-IP67-200-5K', name: 'HV9795-IP67-200-3K - 14.4w IP67 24v DC Side Bend HaviFlex Flexible Neon LED Strip 3000k - 5500K', retailPerM: 92.1910, tradePerM: 66.7590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9795-IP67-200-RGBW', name: 'HV9795-IP67-200-RGBW - 14.4w IP67 24v DC Side Bend HaviFlex Flexible Neon LED Strip RGBW', retailPerM: 103.8345, tradePerM: 75.1905, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9795-IP67-200-SPIRGB', name: 'HV9795-IP67-200-SPIRGB - 20w IP67 24v DC Side Bend Chasing RGB LED Strip - RGBW', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9796-IP67-200-3K', name: 'HV9796-IP67-200-3K - 14.4w IP67 24v DC Top Bend HaviFlex Flexible Neon LED Strip 3000k', retailPerM: 92.1910, tradePerM: 66.7590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9796-IP67-200-4K', name: 'HV9796-IP67-200-4K - 14.4w IP67 24v DC Top Bend HaviFlex Flexible Neon LED Strip 4000k', retailPerM: 92.1910, tradePerM: 66.7590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9796-IP67-200-5K', name: 'HV9796-IP67-200-5K - 14.4w IP67 24v DC Top Bend HaviFlex Flexible Neon LED Strip 5500k', retailPerM: 92.1910, tradePerM: 66.7590, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9796-IP67-200-RGBW', name: 'HV9796-IP67-200-RGBW - 14.4w IP67 24v DC Top Bend HaviFlex Flexible Neon LED Strip RGBW', retailPerM: 103.8345, tradePerM: 75.1905, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 6 },
  { id: 'HV9797-IP68-1018-2K', name: 'HV9797-IP68-1018-2K - 10W IP68 2700K 24v DC Side Bend Haviflex LED Strip', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9797-IP68-1018-3K', name: 'HV9797-IP68-1018-3K - 10W IP68 3000K 24v DC Side Bend Haviflex LED Strip', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9797-IP68-1018-4K', name: 'HV9797-IP68-1018-4K - 10W IP68 4000K 24v DC Side Bend Haviflex LED Strip', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9797-IP68-1018-6K', name: 'HV9797-IP68-1018-6K - 10W IP68 6000K 24v DC Side Bend Haviflex LED Strip - 6500K', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9797-IP68-1018-RGB', name: 'HV9797-IP68-1018-RGB - 5W IP68 RGB 24v DC Side Bend Haviflex LED Strip', retailPerM: 117.2325, tradePerM: 84.8925, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9797-IP68-1018-RGBN', name: 'HV9797-IP68-1018-RGBN - 5W IP68 RGB + 4000K 24v DC Side Bend Haviflex LED Strip', retailPerM: 125.6860, tradePerM: 91.0140, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9797-IP68-1018-RGBW', name: 'HV9797-IP68-1018-RGBW - 5W IP68 RGB + 3000K 24v DC Side Bend Haviflex LED Strip', retailPerM: 125.6860, tradePerM: 91.0140, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9798-IP68-2013-2K', name: 'HV9798-IP68-2013-2K - 10W IP68 2700K 24v DC Top Bend Haviflex LED Strip', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9798-IP68-2013-3K', name: 'HV9798-IP68-2013-3K - 10W IP68 3000K 24v DC Top Bend Haviflex LED Strip', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9798-IP68-2013-4K', name: 'HV9798-IP68-2013-4K - 10W IP68 4000K 24v DC Top Bend Haviflex LED Strip', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9798-IP68-2013-6K', name: 'HV9798-IP68-2013-6K - 10W IP68 6000K 24v DC Top Bend Haviflex LED Strip - 6500K', retailPerM: 108.9385, tradePerM: 78.8865, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9798-IP68-2013-RGB', name: 'HV9798-IP68-2013-RGB - 5W IP68 RGB 24v DC Top Bend Haviflex LED Strip', retailPerM: 117.2325, tradePerM: 84.8925, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9798-IP68-2013-RGBN', name: 'HV9798-IP68-2013-RGBN - 5W IP68 RGB + 4000K 24v DC Top Bend Haviflex LED Strip', retailPerM: 125.6860, tradePerM: 91.0140, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
  { id: 'HV9798-IP68-2013-RGBW', name: 'HV9798-IP68-2013-RGBW - 5W IP68 RGB + 3000K 24v DC Top Bend Haviflex LED Strip', retailPerM: 125.6860, tradePerM: 91.0140, cutMm: 500, maxRunM: 1000, includedTailM: 1, tailPerM: 5 },
];

// Coerce whatever is stored in settings into a usable catalogue. Guards
// against a hand-edited JSON blob with missing/NaN fields taking the
// Strip Cut Counter down.
export function normaliseStripProducts(raw: unknown): StripProduct[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_STRIP_PRODUCTS;
  const num = (v: any, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const cleaned = raw
    .filter((p: any) => p && typeof p.id === 'string' && p.id.trim())
    .map((p: any, i: number): StripProduct => {
      const d = DEFAULT_STRIP_PRODUCTS[i] ?? DEFAULT_STRIP_PRODUCTS[0];
      return {
        id: String(p.id).trim(),
        name: String(p.name ?? d.name),
        retailPerM: num(p.retailPerM, d.retailPerM),
        tradePerM: num(p.tradePerM, d.tradePerM),
        // A zero cut interval would divide-by-zero in the calculator.
        cutMm: Math.max(1, num(p.cutMm, d.cutMm)),
        maxRunM: Math.max(1, num(p.maxRunM, d.maxRunM)),
        includedTailM: num(p.includedTailM, d.includedTailM),
        tailPerM: num(p.tailPerM, d.tailPerM),
      };
    });
  return cleaned.length > 0 ? cleaned : DEFAULT_STRIP_PRODUCTS;
}
