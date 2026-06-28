import sys
import os
from PIL import Image

def main():
    if len(sys.argv) < 3:
        print("Usage: python convert.py <src_png_path> <dest_filename_no_ext>")
        sys.exit(1)
        
    src_path = sys.argv[1]
    dest_name = sys.argv[2]
    
    if not os.path.exists(src_path):
        print(f"Error: source path {src_path} does not exist.")
        sys.exit(1)
        
    dest_dir = r"d:\sugiapp\public\cute"
    os.makedirs(dest_dir, exist_ok=True)
    
    dest_path = os.path.join(dest_dir, f"{dest_name}.webp")
    
    try:
        with Image.open(src_path) as img:
            # Convert to RGB if it's RGBA to prevent background issue or preserve transparency depending on need.
            # webp supports transparency, so saving directly is fine.
            img.save(dest_path, "webp")
            print(f"Successfully converted and saved to: {dest_path}")
    except Exception as e:
        print(f"Error converting image: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
