"""Cinematic Documentary Visual Generator for Ferdinand Waldo Demara story chapters.
Generates 1920x1080 frames with archival documents, dossiers, vintage newspaper headlines,
military orders, medical charts, and dynamic typography with Ken Burns motion.
"""
import os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT_DIR = r'D:\faceless-longform\ferdinand-demara-great-imposter\fonts'

def get_fonts():
    return {
        'title': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 58),
        'head': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 44),
        'sub': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-ExtraBold.otf'), 30),
        'serif_head': ImageFont.truetype(os.path.join(FONT_DIR, 'Caladea-Bold.ttf'), 50),
        'serif_body': ImageFont.truetype(os.path.join(FONT_DIR, 'Caladea-Bold.ttf'), 32),
        'mono': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-ExtraBold.otf'), 24),
        'cap': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 52),
        'stamp': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 64),
    }

def draw_vignette(draw, w, h, base_color=(15, 23, 42)):
    # Subtle radial glow from center
    cx, cy = w // 2, h // 2
    for r in range(900, 100, -50):
        factor = (1.0 - r / 900.0)
        c = (
            int(base_color[0] + 25 * factor),
            int(base_color[1] + 30 * factor),
            int(base_color[2] + 45 * factor)
        )
        draw.ellipse([cx - r * 1.35, cy - r, cx + r * 1.35, cy + r], fill=c)

def draw_card(draw, cx, cy, cw, ch, bg=(245, 240, 225), outline=(180, 160, 130), radius=16):
    box = [cx - cw // 2, cy - ch // 2, cx + cw // 2, cy + ch // 2]
    # Drop shadow
    draw.rounded_rectangle([box[0] + 8, box[1] + 12, box[2] + 8, box[3] + 12], radius=radius, fill=(5, 8, 15))
    draw.rounded_rectangle(box, radius=radius, fill=bg, outline=outline, width=4)
    return box

def draw_stamp(draw, cx, cy, text, color=(220, 38, 38), angle=0, fonts=None):
    # Red official ink stamp
    tw = len(text) * 36 + 40
    th = 84
    box = [cx - tw // 2, cy - th // 2, cx + tw // 2, cy + th // 2]
    draw.rounded_rectangle(box, radius=10, outline=color, width=6)
    draw.text((cx, cy), text, font=fonts['stamp'], fill=color, anchor='mm')

def draw_act_banner(draw, w, act_text, fonts):
    bx, by = w // 2, 75
    bw, bh = 800, 60
    draw.rounded_rectangle([bx - bw // 2, by - bh // 2, bx + bw // 2, by + bh // 2], radius=10, fill=(24, 34, 53), outline=(255, 212, 59), width=2)
    draw.text((bx, by), act_text, font=fonts['sub'], fill=(255, 212, 59), anchor='mm')

def draw_subtitles(draw, w, h, text, words_data, current_time, fonts):
    # Positioned at y = 920, Inter-Black, stroke outline
    y = 920
    # Clean text wrapping
    words = text.split()
    lines = []
    curr = []
    for wd in words:
        curr.append(wd)
        if len(' '.join(curr)) > 45:
            lines.append(' '.join(curr[:-1]))
            curr = [wd]
    if curr:
        lines.append(' '.join(curr))
    
    line_y = y - (len(lines) - 1) * 35
    for l_text in lines:
        # Draw high-contrast black border
        draw.text((w // 2, line_y), l_text, font=fonts['cap'], fill=(255, 255, 255), anchor='mm', stroke_width=9, stroke_fill=(11, 11, 16))
        line_y += 65
