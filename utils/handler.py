import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run_script(script_path: Path) -> bool:
    """Run a Python script and return True on success, False on failure."""
    if not script_path.exists():
        print(f"[SKIP] {script_path.name} not found.")
        return False
    try:
        print(f"\n[RUNNING] {script_path.name}...")
        subprocess.run(
            [sys.executable, str(script_path)],
            check=True,
            cwd=str(ROOT),
        )
        print(f"[OK] {script_path.name} completed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] {script_path.name} failed (exit code {e.returncode})")
        return False


if __name__ == "__main__":
    idiot_check = input(
        "Please confirm you have uploaded the full resolution gallery to the "
        "file hosting site (github) prior to running this script.\n"
        "Your images are about to be irreversibly compressed for website hosting. (yes/no): "
    )
    if idiot_check.lower() != "yes":
        print("Make good decisions.")
        exit()

    scripts = [
        ROOT / "utils" / "img_resizer.py",
        ROOT / "utils" / "manifest_generator.py",
        ROOT / "utils" / "gallery_generator.py",
        ROOT / "utils" / "secrets_setter.py",
    ]

    results = []
    for script in scripts:
        success = run_script(script)
        results.append((script.name, success))

    print("\n── Summary ──")
    all_ok = True
    for name, success in results:
        status = "OK" if success else "FAILED"
        print(f"  {name}: {status}")
        if not success:
            all_ok = False

    if all_ok:
        print("\nAll scripts executed successfully. Ready to deploy!")
    else:
        print("\nSome scripts failed. Please review the errors above.")