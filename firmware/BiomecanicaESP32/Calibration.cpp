#include "Calibration.h"
#include <Preferences.h>

// Cambiar si se modifica la estructura CalibrationData (invalida lo guardado).
static constexpr uint32_t CAL_MAGIC = 0xB10C0001;
static constexpr const char* NVS_NAMESPACE = "biomec";
static constexpr const char* NVS_KEY = "cal";

namespace calstore {

bool load(CalibrationData& out) {
  Preferences p;
  if (!p.begin(NVS_NAMESPACE, true)) return false;
  CalibrationData tmp;
  size_t n = p.getBytes(NVS_KEY, &tmp, sizeof(tmp));
  p.end();
  if (n != sizeof(tmp) || tmp.magic != CAL_MAGIC) return false;
  out = tmp;
  return true;
}

bool save(const CalibrationData& in) {
  Preferences p;
  if (!p.begin(NVS_NAMESPACE, false)) return false;
  CalibrationData tmp = in;
  tmp.magic = CAL_MAGIC;
  size_t n = p.putBytes(NVS_KEY, &tmp, sizeof(tmp));
  p.end();
  return n == sizeof(tmp);
}

}  // namespace calstore
