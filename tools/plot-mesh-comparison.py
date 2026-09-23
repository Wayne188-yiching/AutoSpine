"""Render numeric mesh evidence; optional developer-only Pillow, never an engine dependency.

Usage: python tools/plot-mesh-comparison.py private-config.json baseline-dir candidate-dir output-dir
All private inputs and outputs stay outside the repository.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def render(config_path, baseline_dir, candidate_dir, output_dir):
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 16)
    for entry in config["cases"]:
        name = entry["id"]
        image = Image.open(entry["png"]).convert("RGBA")
        files = [Path(candidate_dir) / f"{name}.artist.json", Path(baseline_dir) / f"{name}.mesh.json", Path(candidate_dir) / f"{name}.mesh.json"]
        labels = ["Artist reference", "Gate 3.1", "Gate 3.2 static"]
        panels = [(label, json.loads(path.read_text(encoding="utf-8"))) for label, path in zip(labels, files) if path.exists()]
        width, height = 430, 690
        canvas = Image.new("RGB", (width * len(panels), height), "#20252d")
        draw = ImageDraw.Draw(canvas)
        scale = min((width - 50) / image.width, (height - 180) / image.height)
        scaled = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.NEAREST)
        for column, (label, mesh) in enumerate(panels):
            ox = column * width + (width - scaled.width) // 2
            oy = 130 + (height - 180 - scaled.height) // 2
            for y in range(oy, oy + scaled.height, 16):
                for x in range(ox, ox + scaled.width, 16):
                    color = "#363b43" if ((x - ox) // 16 + (y - oy) // 16) % 2 else "#444951"
                    draw.rectangle((x, y, min(x+15, ox+scaled.width-1), min(y+15, oy+scaled.height-1)), fill=color)
            canvas.paste(scaled, (ox, oy), scaled)
            points = [(ox + p[0] * scale, oy + p[1] * scale) for p in mesh["vertices"]]
            edges = set()
            indices = mesh["triangles"]
            for i in range(0, len(indices), 3):
                tri = indices[i:i+3]
                for a, b in zip(tri, tri[1:] + tri[:1]):
                    edges.add(tuple(sorted((a, b))))
            for a, b in edges:
                draw.line((points[a], points[b]), fill="#ffcb69", width=1)
            hull = mesh["hull"]
            draw.line([points[i] for i in hull + hull[:1]], fill="#3fe3e7", width=2)
            for i, (x, y) in enumerate(points):
                color = "#3fe3e7" if i in hull else "#ffae42"
                draw.ellipse((x-2.5, y-2.5, x+2.5, y+2.5), fill=color)
            draw.text((column*width+20, 18), f"{name} | {label}", font=small, fill="white")
            draw.text((column*width+20, 53), f"{len(points)} vertices / {len(indices)//3} triangles", font=small, fill="white")
            draw.text((column*width+20, 85), f"{len(hull)} hull + {len(points)-len(hull)} interior", font=small, fill="#bcc8da")
        draw.text((18, height-42), "Exact JSON topology overlay", font=small, fill="white")
        draw.text((18, height-22), "Static only; deformation NOT verified", font=small, fill="white")
        target = destination / f"gate32-{name}.png"
        if target.exists():
            raise FileExistsError(target)
        canvas.save(target)
        print(target)


if __name__ == "__main__":
    render(*sys.argv[1:])
