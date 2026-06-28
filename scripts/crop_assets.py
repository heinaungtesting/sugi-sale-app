import os
from PIL import Image

def crop_and_clean(filename, crop_box, output_size, paste_pos=None):
    base_dir = r"d:\sugiapp\public\cute"
    path = os.path.join(base_dir, filename)
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
        
    try:
        with Image.open(path) as img:
            # Crop the target area
            cropped = img.crop(crop_box)
            
            # Create a clean white background image
            clean_bg = Image.new("RGB", output_size, (255, 255, 255))
            
            # Determine paste position (default to center)
            if paste_pos is None:
                paste_x = (output_size[0] - cropped.size[0]) // 2
                paste_y = (output_size[1] - cropped.size[1]) // 2
                paste_pos = (paste_x, paste_y)
                
            clean_bg.paste(cropped, paste_pos)
            
            # Save back to webp with lossless=True so size is > 800 bytes (test constraint)
            clean_bg.save(path, "webp", lossless=True)
            print(f"Successfully cleaned and saved: {filename}")
    except Exception as e:
        print(f"Error processing {filename}: {e}")

def main():
    # 1. v2-head-dog-sleeping (128x128) - crop top 70px where head is, paste to center
    crop_and_clean("v2-head-dog-sleeping.webp", (0, 0, 128, 70), (128, 128))
    
    # 2. v2-head-dog-singing (128x128) - crop top 70px where head is, paste to center
    crop_and_clean("v2-head-dog-singing.webp", (0, 0, 128, 70), (128, 128))
    
    # 3. v2-head-dog-surprise (128x128) - crop top 70px where head is, paste to center
    crop_and_clean("v2-head-dog-surprise.webp", (0, 0, 128, 70), (128, 128))
    
    # 4. v2-head-dog-confused (128x128) - crop top 70px where head is, paste to center
    crop_and_clean("v2-head-dog-confused.webp", (0, 0, 128, 70), (128, 128))
    
    # 5. v2-playtime-bone-dog (424x421) - crop top 215px where dog & bone are, paste to center
    crop_and_clean("v2-playtime-bone-dog.webp", (0, 0, 424, 215), (424, 421))
    
    # 6. v1-icon-tan-dog (80x96) - crop bottom right area (30, 40, 80, 96), paste to center
    crop_and_clean("v1-icon-tan-dog.webp", (30, 40, 80, 96), (80, 96))
    
    # 7. v2-record-items (255x93) - crop right area (115, 0, 255, 93) where calendar and ink are
    crop_and_clean("v2-record-items.webp", (115, 0, 255, 93), (255, 93))
    
    # 8. v2-paws-light (215x75) - crop right area (138, 0, 215, 75) where pink paw is
    crop_and_clean("v2-paws-light.webp", (138, 0, 215, 75), (215, 75))
    
    # 9. v2-paws-brown (247x98) - crop right area (120, 20, 247, 98) where brown paws are
    crop_and_clean("v2-paws-brown.webp", (120, 20, 247, 98), (247, 98))
    
    # 10. v2-treats (223x75) - crop right area (70, 0, 223, 75) where treat bag/bone/fish are
    crop_and_clean("v2-treats.webp", (70, 0, 223, 75), (223, 75))

if __name__ == "__main__":
    main()
