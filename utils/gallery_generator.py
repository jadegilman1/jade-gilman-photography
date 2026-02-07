import json
import os
import difflib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_IMAGES = ROOT / "public" / "images"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _ensure_jpg_extension(name: str) -> str:
    base, ext = os.path.splitext(name.strip())
    if not base:
        return ""
    if ext.lower() not in (".jpg", ".jpeg"):
        return f"{base}.jpg"
    return f"{base}{ext}"


def _find_case_insensitive_file(folder_path: Path, name: str):
    target = name.lower()
    for f in os.listdir(folder_path):
        if f.lower() == target:
            return f
    return None


def _jpg_files(folder_path: Path):
    return [
        f for f in os.listdir(folder_path)
        if os.path.isfile(folder_path / f) and f.lower().endswith((".jpg", ".jpeg"))
    ]


def _suggest_similar_file(folder_path: Path, target_stem: str):
    files = _jpg_files(folder_path)
    if not files:
        print("No .jpg files found in this directory.")
        return None
    items = [(os.path.splitext(f)[0], f) for f in files]
    lower_to_file = {}
    for stem, fname in items:
        lower_to_file.setdefault(stem.lower(), fname)

    target = target_stem.lower()
    matches = difflib.get_close_matches(target, list(lower_to_file.keys()), n=5, cutoff=0.4)

    if not matches and target:
        matches = [stem.lower() for stem, _ in items if target in stem.lower()][:5]

    if not matches:
        print("No similar filenames found.")
        return None

    options = [lower_to_file[m] for m in matches]
    print("Choose a similar file:")
    for i, opt in enumerate(options, 1):
        print(f"{i}. {opt}")
    while True:
        sel = input(f"Enter a number 1-{len(options)} (or 0 to re-enter): ").strip()
        if sel == "0" or sel == "":
            return None
        if sel.isdigit():
            idx = int(sel)
            if 1 <= idx <= len(options):
                return options[idx - 1]
        print("Invalid selection. Try again.")


def _choose_cover_photo_interactively(folder_path: Path, default_cover: str, gallery_label: str):
    while True:
        entered = input(
            f"Enter the cover photo filename for {gallery_label} "
            f"(assumes .jpg, leave blank to keep default '{default_cover}'): "
        ).strip()
        if not entered:
            return default_cover
        candidate = _ensure_jpg_extension(entered)
        found = _find_case_insensitive_file(folder_path, candidate)
        if found:
            return found
        print(f"'{candidate}' not found.")
        stem = os.path.splitext(entered)[0]
        choice = _suggest_similar_file(folder_path, stem)
        if choice:
            return choice
        print("No selection made. Please try again or leave blank to keep default.")


def generate_galleries_json(directory: Path) -> None:
    """Generate galleries.json from gallery subfolders (non-recursive)."""
    galleries = []
    existing_galleries = {}

    galleries_json_path = directory / "galleries.json"
    if galleries_json_path.exists():
        with open(galleries_json_path, "r", encoding="utf-8") as f:
            existing_data = json.load(f)
            existing_galleries = {
                g["name"]: g for g in existing_data.get("galleries", [])
            }

    for folder in sorted(os.listdir(directory)):
        folder_path = directory / folder
        if not folder_path.is_dir():
            continue

        manifest_path = folder_path / "manifest.json"
        if manifest_path.exists():
            with open(manifest_path, "r", encoding="utf-8") as f:
                images = json.load(f)
        else:
            images = sorted(
                f for f in os.listdir(folder_path)
                if os.path.isfile(folder_path / f) and Path(f).suffix.lower() in IMAGE_EXTS
            )

        if not images:
            continue

        if folder in existing_galleries:
            cover_photo = existing_galleries[folder].get("coverPhoto", images[0])
        else:
            cover_photo = images[0]
            manual_entry = (
                input(f"Do you want to manually enter the cover photo for {folder}? (yes/no): ")
                .strip()
                .lower()
            )
            if manual_entry == "yes":
                cover_photo = _choose_cover_photo_interactively(folder_path, cover_photo, folder)

        title = existing_galleries.get(folder, {}).get("title", folder)
        description = existing_galleries.get(folder, {}).get("description", f"{folder} collection")
        galleries.append({
            "name": folder,
            "title": title,
            "coverPhoto": cover_photo,
            "description": description,
        })

    with open(galleries_json_path, "w", encoding="utf-8") as f:
        json.dump({"galleries": galleries}, f, indent=4, ensure_ascii=False)
    print(f"Generated {galleries_json_path}")


if __name__ == "__main__":
    generate_galleries_json(PUBLIC_IMAGES)