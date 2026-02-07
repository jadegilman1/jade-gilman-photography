import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS_PATH = ROOT / "public" / "secrets.json"


def is_valid_url(url: str) -> bool:
    regex = re.compile(
        r"^(?:http|ftp)s?://"
        r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+(?:[A-Z]{2,6}\.?|[A-Z0-9-]{2,}\.?)|"
        r"localhost|"
        r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
        r"\[?[A-F0-9]*:[A-F0-9:]+\]?)"
        r"(?::\d+)?"
        r"(?:/?|[/?]\S+)$",
        re.IGNORECASE,
    )
    return re.match(regex, url) is not None


def add_gallery_secret(gallery_name: str, password: str, download_link: str) -> None:
    if SECRETS_PATH.exists():
        with open(SECRETS_PATH, "r", encoding="utf-8") as f:
            secrets = json.load(f)
    else:
        secrets = {}

    if gallery_name in secrets:
        print(f"Gallery {gallery_name} already exists in the secrets file.")
        print(f"Existing content: {secrets[gallery_name]}")
        overwrite = input("Do you want to overwrite it? (yes/no): ").strip().lower()
        if overwrite != "yes":
            print("Operation cancelled.")
            return

    if not is_valid_url(download_link):
        print("Invalid download link.")
        return

    secrets[gallery_name] = {
        "password": password,
        "downloadLink": download_link,
    }

    with open(SECRETS_PATH, "w", encoding="utf-8") as f:
        json.dump(secrets, f, indent=4, ensure_ascii=False)
    print(f"Added {gallery_name} to {SECRETS_PATH}")


if __name__ == "__main__":
    print("\nWe will now generate metadata for a new gallery:")
    gallery_name = input("Enter the gallery name: ")
    password = input("Enter the password for the gallery: ")
    download_link = input("Enter the download link: ")

    add_gallery_secret(gallery_name, password, download_link)