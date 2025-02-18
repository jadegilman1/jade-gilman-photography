import os
import json

def generate_galleries_json(directory):
    galleries = []
    for root, dirs, files in os.walk(directory):
        for folder in dirs:
            folder_path = os.path.join(root, folder)
            manifest_path = os.path.join(folder_path, 'manifest.json')
            if os.path.exists(manifest_path):
                with open(manifest_path, 'r') as manifest_file:
                    images = json.load(manifest_file)
                    cover_photo = images[0] if images else ''
                    galleries.append({
                        "name": os.path.relpath(folder_path, directory).replace(os.sep, '-'),
                        "title": folder.replace('-', ' ').title(),
                        "coverPhoto": cover_photo,
                        "description": f"{folder.replace('-', ' ')} collection"
                    })
    galleries_json = {
        "galleries": galleries
    }
    with open(os.path.join(directory, 'galleries.json'), 'w') as json_file:
        json.dump(galleries_json, json_file, indent=4)
    print(f"Generated {os.path.join(directory, 'galleries.json')}")

if __name__ == "__main__":
    images_directory = os.path.join('public', 'images')
    generate_galleries_json(images_directory)