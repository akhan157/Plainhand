"""Offline CPU image-grid classifier for reCAPTCHA v2 challenges.
Runs a fine-tuned ONNX classifier on 3x3 or 4x4 image tiles locally.
"""
import argparse
import json
import numpy as np
import onnxruntime as ort
from PIL import Image

CLASSES = [
    'bicycle', 'bridge', 'bus', 'car', 'chimney',
    'crosswalk', 'hydrant', 'motorcycle', 'mountain',
    'other', 'palm', 'stair', 'tractor', 'traffic light'
]

# Aliases and synonyms
TARGET_MAP = {
    'traffic lights': 'traffic light',
    'traffic light': 'traffic light',
    'bicycles': 'bicycle',
    'bicycle': 'bicycle',
    'bike': 'bicycle',
    'bikes': 'bicycle',
    'motorcycles': 'motorcycle',
    'motorcycle': 'motorcycle',
    'motorbikes': 'motorcycle',
    'buses': 'bus',
    'bus': 'bus',
    'cars': 'car',
    'car': 'car',
    'automobiles': 'car',
    'crosswalks': 'crosswalk',
    'crosswalk': 'crosswalk',
    'pedestrian crossings': 'crosswalk',
    'fire hydrants': 'hydrant',
    'fire hydrant': 'hydrant',
    'hydrants': 'hydrant',
    'hydrant': 'hydrant',
    'chimneys': 'chimney',
    'chimney': 'chimney',
    'bridges': 'bridge',
    'bridge': 'bridge',
    'mountains or hills': 'mountain',
    'mountains': 'mountain',
    'mountain': 'mountain',
    'palm trees': 'palm',
    'palm tree': 'palm',
    'palms': 'palm',
    'stairs': 'stair',
    'stair': 'stair',
    'tractors': 'tractor',
    'tractor': 'tractor',
}

def resolve_target(phrase):
    clean = phrase.lower().strip()
    for key, val in TARGET_MAP.items():
        if key in clean:
            return val
    return None

def preprocess_tile(tile_img):
    resized = tile_img.resize((128, 128), Image.Resampling.BILINEAR)
    arr = np.array(resized, dtype=np.float32) / 255.0
    transposed = np.transpose(arr, (2, 0, 1))
    return np.expand_dims(transposed, axis=0)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, help='Path to ONNX classifier')
    parser.add_argument('--image', required=True, help='Path to composite challenge grid image')
    parser.add_argument('--target', required=True, help='Challenge target string')
    parser.add_argument('--grid', type=int, default=3, help='Grid dimension: 3 for 3x3, 4 for 4x4')
    parser.add_argument('--min-conf', type=float, default=0.25, help='Minimum confidence threshold')
    args = parser.parse_args()

    target_class = resolve_target(args.target)
    if not target_class or target_class not in CLASSES:
        print(json.dumps({'status': 'unsupported', 'target': args.target, 'matchingTiles': []}))
        return

    target_idx = CLASSES.index(target_class)
    session = ort.InferenceSession(args.model)

    grid_img = Image.open(args.image).convert('RGB')
    w, h = grid_img.size
    n = args.grid
    tile_w = w / n
    tile_h = h / n

    matching_tiles = []
    tile_details = []

    for row in range(n):
        for col in range(n):
            tile_idx = row * n + col
            left = int(col * tile_w)
            top = int(row * tile_h)
            right = int((col + 1) * tile_w)
            bottom = int((row + 1) * tile_h)

            tile_crop = grid_img.crop((left, top, right, bottom))
            input_tensor = preprocess_tile(tile_crop)

            logits = session.run(['output0'], {'images': input_tensor})[0][0]
            exp_logits = np.exp(logits - np.max(logits))
            probs = exp_logits / np.sum(exp_logits)

            predicted_class = CLASSES[np.argmax(probs)]
            target_prob = float(probs[target_idx])
            is_match = (predicted_class == target_class) or (target_prob >= args.min_conf)

            if is_match:
                matching_tiles.append(tile_idx)

            tile_details.append({
                'tile': tile_idx,
                'predicted': predicted_class,
                'targetProb': round(target_prob, 3),
                'match': is_match
            })

    print(json.dumps({
        'status': 'success',
        'targetClass': target_class,
        'matchingTiles': matching_tiles,
        'details': tile_details
    }))

if __name__ == '__main__':
    main()
