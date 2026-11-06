"""Reject unsupported fractional precision before converting an original token."""
from decimal import Decimal
import math

MAX_SAFE_INTEGER = 2**53 - 1

def json_float(value: str | Decimal) -> int | float:
    decimal = Decimal(value)
    if not decimal.is_finite():
        raise ValueError("Sonlu JSON sayıları bekleniyor.")
    if not math.isfinite(float(decimal)):
        raise ValueError("Sonlu JSON sayıları bekleniyor; üslü/ondalıklı sayı taşması desteklenmiyor.")
    if decimal == decimal.to_integral_value() and abs(decimal) > MAX_SAFE_INTEGER:
        if decimal.adjusted() >= 4096:
            raise ValueError("JSON sayısı güvenli işlem sınırını aşıyor.")
        return int(decimal)
    result = float(decimal)
    if not math.isfinite(result) or Decimal(str(result)) != decimal:
        raise ValueError("JSON kesirli sayısı hassasiyet kaybı olmadan işlenemiyor; veri değiştirilmedi.")
    return result
