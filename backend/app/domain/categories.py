import unicodedata

# ECMAScript String.trim whitespace, including BOM, excluding U+0085.
JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def trim_name(name: str) -> str:
    return name.strip(JS_WHITESPACE)


def _before_dot(value: str, index: int) -> bool:
    for position in range(index + 1,len(value)):
        char = value[position]
        if char == "\u0307":
            return True
        if unicodedata.combining(char) in (0, 230):
            break
    return False


def _after_i(value: str, index: int) -> bool:
    for position in range(index-1,-1,-1):
        char = value[position]
        if char == "I":
            return True
        if unicodedata.combining(char) in (0, 230):
            break
    return False


def turkish_lower(value: str) -> str:
    # Turkish SpecialCasing contexts use the original string, before lowercasing.
    mapped = []
    for index, char in enumerate(value):
        if char == "I":
            mapped.append("i" if _before_dot(value, index) else "ı")
        elif char == "İ":
            mapped.append("i")
        elif char == "\u0307" and _after_i(value, index):
            continue
        else:
            mapped.append(char)
    return "".join(mapped).lower()


def category_key(name: str) -> str:
    return turkish_lower(unicodedata.normalize("NFC", trim_name(name)))


def category_sort_key(name: str) -> tuple:
    # Deterministic Turkish alphabet order without changing process-wide locale.
    alphabet = "abcçdefgğhıijklmnoöpqrsştuüvwxyz"
    return tuple((0, alphabet.index(char)) if char in alphabet else (1, ord(char)) for char in category_key(name))


def validate_new_name(name: str) -> str:
    if not isinstance(name, str):
        raise ValueError("Kategori adı metin olmalı.")
    name = trim_name(name)
    if not name:
        raise ValueError("Kategori adı boş bırakılamaz.")
    if len(name.encode("utf-16-le")) // 2 > 80:
        raise ValueError("Kategori adı en fazla 80 karakter olabilir.")
    return name


def validate_catalog(value: object) -> list[tuple[str, list[str]]]:
    if not isinstance(value, list):
        raise ValueError("category_catalog bir kategori dizisi olmalı.")
    result = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not trim_name(item["name"]):
            raise ValueError("Kategori listesinde geçersiz bir ana kategori var.")
        children = item.get("subcategories")
        if not isinstance(children, list) or any(not isinstance(child, str) or not trim_name(child) for child in children):
            raise ValueError("Kategori listesinde geçersiz bir alt kategori var.")
        # Like CategoryCatalog.import(), the 80-character limit applies only to
        # manually added names, not to pre-existing names in imported metadata.
        result.append((trim_name(item["name"]), [trim_name(child) for child in children]))
    return result
