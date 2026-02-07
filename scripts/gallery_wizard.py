import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List

from PIL import Image
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "utils"))

from thumb_generator import generate_thumbs
REGISTRY_PATH = ROOT / "data" / "galleries.json"
PUBLIC_IMAGES = ROOT / "public" / "images"
OUTPUT_JSON = ROOT / "public" / "galleries.json"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
RESIZE_TARGET = (1600, 1200)
MAX_WORKERS = os.cpu_count() or 4

ResamplingAttr = getattr(Image, "Resampling", None)
if ResamplingAttr:
    RESAMPLE: Any = getattr(
        ResamplingAttr, "LANCZOS",
        getattr(ResamplingAttr, "BICUBIC", getattr(ResamplingAttr, "NEAREST", 1)),
    )
else:
    RESAMPLE: Any = getattr(
        Image, "LANCZOS", getattr(Image, "BICUBIC", getattr(Image, "NEAREST", 1))
    )


# ── Registry I/O (JSON) ────────────────────────────────────────────────────


def load_registry() -> Dict:
    if not REGISTRY_PATH.exists():
        return {"galleries": []}
    with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        return {"galleries": []}
    data.setdefault("galleries", [])
    return data


def save_registry(data: Dict) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ── Validation helpers ──────────────────────────────────────────────────────


def validate_gallery_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise SystemExit("Gallery name is required and cannot be empty.")
    illegal_chars = set('<>:"/\\|?*')
    if any(ch in illegal_chars for ch in cleaned):
        raise SystemExit('Gallery name cannot contain characters <>:"/\\|?*.')
    if cleaned in {".", ".."}:
        raise SystemExit("Gallery name cannot be '.' or '..'.")
    return cleaned


# ── Interactive helpers ─────────────────────────────────────────────────────


def prompt(text: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{text}{suffix}: ").strip()
    return value or default


def confirm(text: str, default: str = "y") -> bool:
    suffix = f" [{default}]" if default else ""
    choice = input(f"{text}{suffix}: ").strip().lower()
    choice = choice or default.lower()
    return choice.startswith("y")


def list_galleries(registry: Dict) -> None:
    if not registry["galleries"]:
        print("No galleries yet. Add a new one.")
        return
    print("\nExisting galleries:")
    for idx, g in enumerate(registry["galleries"], 1):
        print(f" {idx}. {g.get('name', g.get('title', 'Untitled'))}")


_BLANK_ENTRY: Dict = {
    "name": "", "folder": "", "title": "",
    "cover": "", "password": "", "download_link": "",
}


def choose_gallery(registry: Dict) -> Dict:
    list_galleries(registry)
    total = len(registry["galleries"])
    choice = input("\nEnter number to edit, or 'n' to add a new gallery: ").strip().lower()
    if choice == "n" or not registry["galleries"]:
        return _BLANK_ENTRY.copy()
    if not choice.isdigit():
        print("Invalid choice; starting a new gallery.")
        return _BLANK_ENTRY.copy()
    idx = int(choice)
    if 1 <= idx <= total:
        return registry["galleries"][idx - 1].copy()
    print("Out of range; starting a new gallery.")
    return _BLANK_ENTRY.copy()


# ── Folder / image helpers ──────────────────────────────────────────────────


def ensure_folder(folder_name: str) -> Path:
    folder_path = PUBLIC_IMAGES / folder_name
    if folder_path.exists():
        return folder_path
    create = input(f"Folder '{folder_path}' is missing. Create it now? (y/n) ").strip().lower() or "y"
    if create == "y":
        folder_path.mkdir(parents=True, exist_ok=True)
        print(f"\nCreated folder:\n  {folder_path}\n")
        print("Add your photos to this folder, then press Enter to continue.")
        input("Press Enter when photos are ready… ")

        # Re-check that images were actually added
        images = [
            f for f in os.listdir(folder_path)
            if os.path.isfile(folder_path / f) and Path(f).suffix.lower() in IMAGE_EXTS
        ]
        if not images:
            raise SystemExit("No images found in the folder. Add photos and re-run the wizard.")
        print(f"Found {len(images)} images. Continuing…\n")
        return folder_path
    raise SystemExit("Folder missing. Please create it and add images first.")


def find_images(folder: Path) -> List[str]:
    return sorted(
        f for f in os.listdir(folder)
        if os.path.isfile(folder / f) and Path(f).suffix.lower() in IMAGE_EXTS
    )


# ── Resize logic (multi-threaded) ──────────────────────────────────────────


def _needs_resize(file_path: Path) -> bool:
    try:
        with Image.open(file_path) as img:
            w, h = img.size
            return w > RESIZE_TARGET[0] or h > RESIZE_TARGET[1]
    except OSError:
        return False


def already_resized(folder: Path) -> bool:
    photos = find_images(folder)
    if not photos:
        return False
    # Sample check for large galleries to avoid opening every file
    sample = photos if len(photos) <= 10 else photos[:: max(1, len(photos) // 10)]
    return not any(_needs_resize(folder / f) for f in sample)


def _resize_one(file_path: Path) -> None:
    try:
        with Image.open(file_path) as img:
            if img.width <= RESIZE_TARGET[0] and img.height <= RESIZE_TARGET[1]:
                return
            img.thumbnail(RESIZE_TARGET, RESAMPLE)
            img.save(file_path, quality=85, optimize=True)
    except (OSError, Image.DecompressionBombError) as e:
        print(f"Warning: Could not process {file_path.name}: {e}")


def resize_images(folder: Path) -> None:
    photos = find_images(folder)
    if not photos:
        print("No images to resize.")
        return
    paths = [folder / f for f in photos]
    print(f"\nResizing {len(paths)} images ({MAX_WORKERS} threads)…")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_resize_one, p): p for p in paths}
        for fut in tqdm(as_completed(futures), total=len(futures), desc="Resizing", unit="file"):
            fut.result()


# ── Cover photo ─────────────────────────────────────────────────────────────


def choose_cover(photos: List[str], current_cover: str) -> str:
    if not photos:
        return ""
    if current_cover in photos:
        if confirm(f"Keep current cover '{current_cover}'?"):
            return current_cover

    print("\nAvailable images:")
    for i, p in enumerate(photos, 1):
        print(f"  {i}. {p}")

    while True:
        choice = input(f"\nChoose a cover photo [1-{len(photos)}] (default: 1): ").strip()
        if not choice:
            cover = photos[0]
            break
        if choice.isdigit():
            idx = int(choice)
            if 1 <= idx <= len(photos):
                cover = photos[idx - 1]
                break
        print(f"Please enter a number between 1 and {len(photos)}.")

    print(f"Cover photo: {cover}")
    return cover


# ── Entry CRUD ──────────────────────────────────────────────────────────────


def update_entry(entry: Dict) -> Dict:
    single_name = prompt(
        "Gallery name (used for display, title, and folder under public/images)",
        entry.get("name", ""),
    )
    validated_name = validate_gallery_name(single_name)

    folder_path = ensure_folder(validated_name)
    photos = find_images(folder_path)
    if not photos:
        raise SystemExit(f"Folder '{folder_path}' has no images. Add photos before running the wizard.")

    if already_resized(folder_path):
        print("Images are already at or below the web size target; skipping resize.")
    else:
        if confirm("Resize images for web? This overwrites the files in this folder."):
            resize_images(folder_path)
            photos = find_images(folder_path)
        else:
            print("Skipped resizing. If images are large, the site may load slowly.")

    # Always generate / refresh thumbnails for grid & cover views
    print("Generating thumbnails…")
    generate_thumbs(folder_path)

    # Generate manifest.json so the frontend can list gallery images
    manifest_path = folder_path / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(photos, mf, indent=4, ensure_ascii=False)
    print(f"Generated {manifest_path.name} ({len(photos)} images)")

    cover = choose_cover(photos, entry.get("cover", ""))

    password = prompt("Passcode (visible to users)", entry.get("password", ""))
    download_link = prompt("Download link (public)", entry.get("download_link", ""))

    return {
        "name": validated_name,
        "folder": validated_name,
        "title": validated_name,
        "cover": cover,
        "password": password,
        "download_link": download_link,
    }


def persist_entry(registry: Dict, updated: Dict) -> None:
    existing = {g.get("name"): i for i, g in enumerate(registry["galleries"])}
    key = updated.get("name")
    if key in existing:
        registry["galleries"][existing[key]] = updated
    else:
        registry["galleries"].append(updated)
    registry["galleries"].sort(key=lambda g: g.get("title", g.get("name", "")))


# ── Public payload generation ───────────────────────────────────────────────


def build_public_payload(registry: Dict) -> Dict:
    payload: Dict = {"galleries": []}
    for entry in registry["galleries"]:
        folder_path = PUBLIC_IMAGES / entry.get("folder", entry.get("name", ""))

        if not folder_path.exists():
            # Gallery folder was deleted; skip it in the public payload
            continue

        photos = find_images(folder_path)
        cover = entry.get("cover") or ""
        if not cover and photos:
            cover = photos[0]
        elif cover and photos and cover not in photos:
            print(f"Cover '{cover}' not found in {folder_path}; using first image.")
            cover = photos[0]

        name = entry.get("name")
        payload["galleries"].append({
            "name": name,
            "title": entry.get("title"),
            "coverPhoto": cover,
            "password": entry.get("password", ""),
            "downloadLink": entry.get("download_link", ""),
        })
    return payload


def write_public_files(payload: Dict) -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


# ── Main ────────────────────────────────────────────────────────────────────


def main():
    print("\nStarting Gallery Wizard")
    registry = load_registry()
    entry = choose_gallery(registry)
    updated_entry = update_entry(entry)
    folder_path = PUBLIC_IMAGES / updated_entry["folder"]
    photos = find_images(folder_path)
    cover = updated_entry.get("cover", "")

    print("\nReview before saving:")
    print(f"- Name/Title/Folder: {updated_entry['name']}")
    print(f"- Folder path: {folder_path}")
    print(f"- Photos found: {len(photos)}")
    print(f"- Cover photo: {cover if cover else 'First image will be used'}")
    pwd = updated_entry.get('password') or ''
    print(f"- Passcode: {pwd if pwd else '<not set>'}")
    print(f"- Download link: {updated_entry.get('download_link') or '<not set>'}")

    if not confirm("Does this look correct? Proceed to save and update the site files."):
        raise SystemExit("Canceled. No files were changed.")

    persist_entry(registry, updated_entry)
    save_registry(registry)
    payload = build_public_payload(registry)
    write_public_files(payload)
    print(f"\nDone. Updated registry: {REGISTRY_PATH}")
    print(f"Updated public data: {OUTPUT_JSON}")
    print("You can now deploy.")


if __name__ == "__main__":
    main()
