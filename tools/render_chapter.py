"""High-Performance Chapter & Master Assembler for Faceless Longform Video Pipeline.
Pre-renders line scenes for 150+ fps encoding, renders all chapters,
and stitches ch1-ch5 into renders/full.mp4 with exact chapter timestamps.
"""
import os, sys, json, math, subprocess, time
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT = r'D:\faceless-longform\ferdinand-demara-great-imposter'
FONT_DIR = os.path.join(ROOT, 'fonts')
WIDTH, HEIGHT = 1920, 1080
FPS = 24

def get_fonts():
    return {
        'title': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 64),
        'head': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 46),
        'sub': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-ExtraBold.otf'), 30),
        'serif_head': ImageFont.truetype(os.path.join(FONT_DIR, 'Caladea-Bold.ttf'), 52),
        'serif_body': ImageFont.truetype(os.path.join(FONT_DIR, 'Caladea-Bold.ttf'), 34),
        'cap': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 52),
        'stamp': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-Black.otf'), 58),
        'badge': ImageFont.truetype(os.path.join(FONT_DIR, 'Inter-ExtraBold.otf'), 22),
    }

def create_base_background(base=(15, 23, 42)):
    im = Image.new('RGB', (WIDTH, HEIGHT), base)
    draw = ImageDraw.Draw(im)
    cx, cy = WIDTH // 2, HEIGHT // 2
    for r in range(950, 80, -40):
        f = (1.0 - r / 950.0)
        c = (
            int(min(255, base[0] + 30 * f)),
            int(min(255, base[1] + 38 * f)),
            int(min(255, base[2] + 55 * f))
        )
        draw.ellipse([cx - r * 1.4, cy - r, cx + r * 1.4, cy + r], fill=c)
    return im

def draw_card(draw, cx, cy, cw, ch, bg=(245, 240, 225), outline=(180, 160, 130), radius=16):
    box = [cx - cw // 2, cy - ch // 2, cx + cw // 2, cy + ch // 2]
    draw.rounded_rectangle([box[0] + 10, box[1] + 14, box[2] + 10, box[3] + 14], radius=radius, fill=(5, 8, 14))
    draw.rounded_rectangle(box, radius=radius, fill=bg, outline=outline, width=4)
    return box

def draw_stamp(draw, cx, cy, text, color=(220, 38, 38), fonts=None):
    tw = len(text) * 34 + 50
    th = 80
    box = [cx - tw // 2, cy - th // 2, cx + tw // 2, cy + th // 2]
    draw.rounded_rectangle(box, radius=8, outline=color, width=6)
    draw.text((cx, cy), text, font=fonts['stamp'], fill=color, anchor='mm')

def draw_header(draw, act_num, act_title, fonts):
    bx, by = WIDTH // 2, 70
    bw, bh = 860, 56
    draw.rounded_rectangle([bx - bw // 2, by - bh // 2, bx + bw // 2, by + bh // 2], radius=12, fill=(24, 34, 53), outline=(255, 212, 59), width=2)
    draw.text((bx, by), f"ACT {act_num}: {act_title.upper()}", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')

def draw_scene(draw, ch, line_idx, line_text, fonts):
    cx, cy = WIDTH // 2, 470
    if ch == 2:
        draw_header(draw, "II", "The Boy Who Could Memorize Anything", fonts)
        if line_idx == 0:
            b = draw_card(draw, cx, cy, 940, 580)
            draw.rectangle([b[0], b[1], b[2], b[1] + 80], fill=(24, 43, 73))
            draw.text((cx, b[1] + 40), "FEDERAL INVESTIGATION DOSSIER", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "SUBJECT: FERDINAND WALDO DEMARA JR.", font=fonts['serif_head'], fill=(20, 30, 45), anchor='mm')
            draw.text((cx, b[1] + 210), "KNOWN AS 'THE GREAT IMPOSTER'", font=fonts['head'], fill=(185, 28, 28), anchor='mm')
            draw_stamp(draw, cx, b[1] + 320, "CLASSIFIED // TOP SECRET", color=(220, 38, 38), fonts=fonts)
            draw.text((cx, b[1] + 430), "RECORDS: 16 WARSHIP OPERATIONS · 0 FATALITIES", font=fonts['sub'], fill=(50, 60, 75), anchor='mm')
            draw.text((cx, b[1] + 490), "PRIMARY TALENT: PERFECT EIDETIC MEMORY", font=fonts['sub'], fill=(15, 23, 42), anchor='mm')
        elif line_idx == 1:
            b = draw_card(draw, cx, cy, 900, 540)
            draw.rectangle([b[0], b[1], b[2], b[1] + 75], fill=(30, 50, 80))
            draw.text((cx, b[1] + 37), "COMMONWEALTH OF MASSACHUSETTS", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 130), "CERTIFICATE OF BIRTH", font=fonts['serif_head'], fill=(25, 35, 50), anchor='mm')
            draw.text((cx, b[1] + 220), "Ferdinand Waldo Demara Jr.", font=fonts['title'], fill=(24, 43, 73), anchor='mm')
            draw.text((cx, b[1] + 310), "DATE: DECEMBER 21, 1921 · LAWRENCE, MA", font=fonts['sub'], fill=(60, 70, 85), anchor='mm')
            draw.text((cx, b[1] + 380), "FAMILY: AFFLUENT THEATRICAL PROMOTERS", font=fonts['sub'], fill=(60, 70, 85), anchor='mm')
            draw_stamp(draw, cx, b[1] + 460, "OFFICIAL ARCHIVE", color=(30, 130, 60), fonts=fonts)
        elif line_idx == 2:
            b = draw_card(draw, cx, cy, 960, 560, bg=(20, 28, 45), outline=(255, 212, 59))
            draw.text((cx, b[1] + 90), "DEMARA MAJESTIC THEATRE", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 160), "BROADWAY ROADSHOWS · MOTION PICTURES", font=fonts['sub'], fill=(220, 230, 245), anchor='mm')
            draw.rounded_rectangle([cx - 360, b[1] + 220, cx + 360, b[1] + 380], radius=12, fill=(35, 48, 75), outline=(255, 212, 59), width=2)
            draw.text((cx, b[1] + 270), "PALATIAL 12-ROOM MANSION", font=fonts['head'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 330), "PRIVATE AUTOMOBILES · PRIVATE SERVANTS", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 460), "A CHILDHOOD OF IMMENSE WEALTH & SPLENDOR", font=fonts['serif_body'], fill=(180, 200, 225), anchor='mm')
        elif line_idx == 3:
            b = draw_card(draw, cx, cy, 980, 580, bg=(15, 30, 55), outline=(0, 210, 211))
            draw.text((cx, b[1] + 80), "THE PHENOMENAL BRAIN", font=fonts['title'], fill=(0, 210, 211), anchor='mm')
            draw.text((cx, b[1] + 150), "EIDETIC / PHOTOGRAPHIC MEMORY", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.rounded_rectangle([cx - 400, b[1] + 210, cx + 400, b[1] + 410], radius=14, fill=(10, 20, 38), outline=(0, 210, 211), width=2)
            draw.text((cx, b[1] + 270), "SINGLE-PASS RETENTION: 100%", font=fonts['head'], fill=(46, 204, 113), anchor='mm')
            draw.text((cx, b[1] + 330), "READ A BOOK ONCE — REPEAT ENTIRE PAGES VERBATIM", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 490), "THE FOUNDATION OF EVERY FUTURE CON", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
        elif line_idx == 4 or line_idx == 5:
            b = draw_card(draw, cx, cy, 960, 560, bg=(240, 235, 220), outline=(100, 40, 40))
            draw.rectangle([b[0], b[1], b[2], b[1] + 70], fill=(20, 20, 20))
            draw.text((cx, b[1] + 35), "THE BOSTON DAILY HERALD — OCTOBER 1929", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 130), "WALL STREET CRASHES!", font=fonts['serif_head'], fill=(180, 20, 20), anchor='mm')
            draw.text((cx, b[1] + 200), "BANKS COLLAPSE · THEATRES GO DARK", font=fonts['head'], fill=(30, 30, 30), anchor='mm')
            draw_stamp(draw, cx, b[1] + 310, "BANKRUPTCY & FORECLOSURE", color=(180, 20, 20), fonts=fonts)
            draw.text((cx, b[1] + 420), "THE MANSION WAS SOLD · SAVINGS VANISHED", font=fonts['sub'], fill=(60, 40, 40), anchor='mm')
            draw.text((cx, b[1] + 480), "MOVED INTO THE POOREST SLUMS OF TOWN", font=fonts['sub'], fill=(100, 20, 20), anchor='mm')
        elif line_idx == 6 or line_idx == 7:
            b = draw_card(draw, cx, cy, 920, 550, bg=(22, 28, 42), outline=(255, 212, 59))
            draw.text((cx, b[1] + 80), "THE DEFIANT VOW", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 160), "'I REFUSE TO LIVE IN POVERTY'", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 380, b[1] + 230, cx + 380, b[1] + 410], radius=14, fill=(15, 20, 30), outline=(180, 160, 130), width=2)
            draw.text((cx, b[1] + 290), "AGE 16: RAN AWAY FROM HOME", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 350), "ENTERED CISTERCIAN MONASTERY · VOW OF SILENCE", font=fonts['sub'], fill=(220, 220, 220), anchor='mm')
            draw.text((cx, b[1] + 480), "SEEKING DISCIPLINE, DIGNITY, AND HIGH CALLING", font=fonts['sub'], fill=(0, 210, 211), anchor='mm')
        elif line_idx == 8 or line_idx == 9:
            b = draw_card(draw, cx, cy, 940, 560, bg=(245, 240, 230), outline=(130, 90, 40))
            draw.text((cx, b[1] + 70), "ORDO CISTERCIENSIS STRICTIORIS OBSERVANTIAE", font=fonts['sub'], fill=(100, 70, 30), anchor='mm')
            draw.text((cx, b[1] + 140), "THE MONASTERY YEARS", font=fonts['serif_head'], fill=(40, 30, 15), anchor='mm')
            draw.text((cx, b[1] + 210), "THEOLOGY · PHILOSOPHY · LATIN SCHOLARSHIP", font=fonts['head'], fill=(30, 40, 70), anchor='mm')
            draw.rounded_rectangle([cx - 380, b[1] + 270, cx + 380, b[1] + 410], radius=10, fill=(230, 220, 200), outline=(150, 110, 50), width=2)
            draw.text((cx, b[1] + 320), "BUT THE SILENCE BORED HIM.", font=fonts['head'], fill=(180, 30, 30), anchor='mm')
            draw.text((cx, b[1] + 370), "HE CRAVED PRESTIGE. HE CRAVED AUTHORITY.", font=fonts['sub'], fill=(20, 20, 20), anchor='mm')
            draw.text((cx, b[1] + 480), "THE WORLD BECAME HIS THEATRE", font=fonts['title'], fill=(185, 28, 28), anchor='mm')
        elif line_idx >= 10 and line_idx <= 12:
            b = draw_card(draw, cx, cy, 960, 560, bg=(235, 230, 215), outline=(180, 50, 50))
            draw.rectangle([b[0], b[1], b[2], b[1] + 70], fill=(40, 50, 35))
            draw.text((cx, b[1] + 35), "WAR DEPARTMENT · SELECTIVE SERVICE RECORD 1941", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 130), "MILITARY POLICE BULLETIN", font=fonts['serif_head'], fill=(180, 20, 20), anchor='mm')
            draw_stamp(draw, cx, b[1] + 230, "AWOL // FUGITIVE", color=(200, 30, 30), fonts=fonts)
            draw.text((cx, b[1] + 330), "STOLE ARMY BUDDY'S PAPERS · ENLISTED IN NAVY", font=fonts['head'], fill=(20, 30, 45), anchor='mm')
            draw.text((cx, b[1] + 400), "FAKED SUICIDE AT BOSTON PIER (LEFT CLOTHES ON DOCK)", font=fonts['sub'], fill=(60, 60, 60), anchor='mm')
            draw.text((cx, b[1] + 480), "WANTED BY FBI ACROSS ENTIRE CONTINENT", font=fonts['sub'], fill=(180, 20, 20), anchor='mm')
        elif line_idx >= 13 and line_idx <= 16:
            b = draw_card(draw, cx, cy, 980, 570, bg=(20, 30, 48), outline=(255, 212, 59))
            draw.text((cx, b[1] + 60), "A DECADE OF STOLEN LIVES", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.rounded_rectangle([cx - 420, b[1] + 110, cx + 420, b[1] + 450], radius=12, fill=(12, 18, 30), outline=(80, 110, 160), width=2)
            draw.text((cx, b[1] + 160), "1. TRAPPIST MONK (BROTHER JEROME)", font=fonts['sub'], fill=(220, 220, 220), anchor='mm')
            draw.text((cx, b[1] + 220), "2. COLLEGE PROFESSOR (DR. ROBERT FRENCH, PH.D.)", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 280), "3. DEAN OF PSYCHOLOGY (GANNON COLLEGE)", font=fonts['sub'], fill=(0, 210, 211), anchor='mm')
            draw.text((cx, b[1] + 340), "4. FOUNDED NOTRE DAME COLLEGE OF MAINE", font=fonts['sub'], fill=(46, 204, 113), anchor='mm')
            draw.text((cx, b[1] + 400), "PACKED ONE SUITCASE & DISAPPEARED EVERY TIME", font=fonts['sub'], fill=(235, 77, 75), anchor='mm')
            draw.text((cx, b[1] + 510), "EVERY CON SUCCEEDED BEYOND BELIEF", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
        else:
            b = draw_card(draw, cx, cy, 940, 550, bg=(245, 240, 225), outline=(24, 43, 73))
            draw.rectangle([b[0], b[1], b[2], b[1] + 75], fill=(24, 43, 73))
            draw.text((cx, b[1] + 37), "GRAND FALLS, NEW BRUNSWICK · 1951", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "THE FATAL MEETING", font=fonts['serif_head'], fill=(20, 30, 45), anchor='mm')
            draw.text((cx, b[1] + 220), "DR. JOSEPH CYR, M.D.", font=fonts['title'], fill=(185, 28, 28), anchor='mm')
            draw.text((cx, b[1] + 310), "A QUIET, HUMBLE CANADIAN PHYSICIAN", font=fonts['head'], fill=(50, 60, 75), anchor='mm')
            draw_stamp(draw, cx, b[1] + 420, "TARGET ACQUIRED", color=(185, 28, 28), fonts=fonts)
            draw.text((cx, b[1] + 490), "THE BIGGEST CON IN NAVAL HISTORY WAS ABOUT TO BEGIN", font=fonts['sub'], fill=(24, 43, 73), anchor='mm')

    elif ch == 3:
        draw_header(draw, "III", "The Stolen Identity of Dr. Joseph Cyr", fonts)
        if line_idx <= 2:
            b = draw_card(draw, cx, cy, 940, 560)
            draw.rectangle([b[0], b[1], b[2], b[1] + 75], fill=(24, 43, 73))
            draw.text((cx, b[1] + 37), "CANADIAN MEDICAL CORPS DIRECTORY", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "THE YOUNG PHYSICIAN", font=fonts['serif_head'], fill=(30, 40, 55), anchor='mm')
            draw.text((cx, b[1] + 220), "DR. JOSEPH CYR, M.D.", font=fonts['title'], fill=(24, 43, 73), anchor='mm')
            draw.text((cx, b[1] + 300), "GRADUATE: LAVAL UNIVERSITY MEDICAL SCHOOL", font=fonts['sub'], fill=(70, 80, 95), anchor='mm')
            draw.text((cx, b[1] + 370), "DEMARA APPEARS WEARING A CLERICAL COLLAR", font=fonts['head'], fill=(185, 28, 28), anchor='mm')
            draw.text((cx, b[1] + 460), "OFFERS TO EXPEDITE NAVAL COMMISSION PAPERS", font=fonts['sub'], fill=(30, 120, 60), anchor='mm')
        elif line_idx <= 5:
            b = draw_card(draw, cx, cy, 960, 570, bg=(240, 235, 220), outline=(180, 40, 40))
            draw.rectangle([b[0], b[1], b[2], b[1] + 75], fill=(120, 30, 30))
            draw.text((cx, b[1] + 37), "DEPARTMENT OF NATIONAL DEFENCE · OTTAWA", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 130), "THE STOLEN CREDENTIALS", font=fonts['serif_head'], fill=(20, 20, 20), anchor='mm')
            draw_stamp(draw, cx, b[1] + 230, "IDENTITY THEFT", color=(180, 30, 30), fonts=fonts)
            draw.text((cx, b[1] + 330), "STOLEN: ORIGINAL BIRTH CERTIFICATE", font=fonts['sub'], fill=(50, 50, 50), anchor='mm')
            draw.text((cx, b[1] + 380), "STOLEN: MEDICAL DIPLOMA & UNIVERSITY TRANSCRIPTS", font=fonts['sub'], fill=(50, 50, 50), anchor='mm')
            draw.text((cx, b[1] + 430), "MAILED APPLICATION TO OTTAWA UNDER HIS OWN FACE", font=fonts['head'], fill=(180, 30, 30), anchor='mm')
            draw.text((cx, b[1] + 500), "APPROVED WITHIN WEEKS · ZERO BACKGROUND CHECKS", font=fonts['sub'], fill=(20, 100, 40), anchor='mm')
        elif line_idx <= 8:
            b = draw_card(draw, cx, cy, 960, 560, bg=(18, 30, 50), outline=(255, 212, 59))
            draw.text((cx, b[1] + 70), "ROYAL CANADIAN NAVY APPOINTMENT", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "COMMISSIONED: SURGEON LIEUTENANT", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 400, b[1] + 190, cx + 400, b[1] + 380], radius=14, fill=(10, 20, 35), outline=(255, 212, 59), width=2)
            draw.text((cx, b[1] + 250), "WARSHIP: HMCS CAYUGA (DDE 218)", font=fonts['head'], fill=(0, 210, 211), anchor='mm')
            draw.text((cx, b[1] + 310), "MISSION: ARCTIC PATROL & COMBAT IN KOREA", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw_stamp(draw, cx, b[1] + 460, "ACTIVE COMBAT DEPLOYMENT", color=(255, 212, 59), fonts=fonts)
        elif line_idx <= 12:
            b = draw_card(draw, cx, cy, 960, 560, bg=(245, 240, 225), outline=(30, 50, 80))
            draw.rectangle([b[0], b[1], b[2], b[1] + 70], fill=(30, 50, 80))
            draw.text((cx, b[1] + 35), "MEDICAL PREPARATION: PACIFIC VOYAGE", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 130), "THE SPEED-READING SURGEON", font=fonts['serif_head'], fill=(20, 30, 45), anchor='mm')
            draw.text((cx, b[1] + 210), "BOUGHT 2 SURGICAL MANUALS AT VANCOUVER DOCKS", font=fonts['head'], fill=(185, 28, 28), anchor='mm')
            draw.rounded_rectangle([cx - 380, b[1] + 260, cx + 380, b[1] + 420], radius=10, fill=(235, 228, 210), outline=(160, 140, 110), width=2)
            draw.text((cx, b[1] + 310), "MEMORIZED THORACIC SURGERY & PENICILLIN DOSES", font=fonts['sub'], fill=(30, 30, 30), anchor='mm')
            draw.text((cx, b[1] + 370), "NIGHT AFTER NIGHT IN HIS CABIN BY FLASHLIGHT", font=fonts['sub'], fill=(60, 60, 60), anchor='mm')
            draw.text((cx, b[1] + 490), "COMMITTING THE HUMAN BODY TO MEMORY", font=fonts['title'], fill=(24, 43, 73), anchor='mm')
        else:
            b = draw_card(draw, cx, cy, 960, 560, bg=(20, 28, 44), outline=(46, 204, 113))
            draw.text((cx, b[1] + 70), "THE SHIPBOARD STRATEGY", font=fonts['title'], fill=(46, 204, 113), anchor='mm')
            draw.text((cx, b[1] + 150), "'DELEGATE ALL ROUTINE MEDICINE'", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 400, b[1] + 210, cx + 400, b[1] + 400], radius=12, fill=(12, 18, 30), outline=(46, 204, 113), width=2)
            draw.text((cx, b[1] + 270), "ORDERED SICKBERTH ATTENDANTS TO HANDLE CLINIC", font=fonts['sub'], fill=(220, 220, 220), anchor='mm')
            draw.text((cx, b[1] + 330), "THE CREW REVERED HIM FOR HIS HUMILITY & TRUST", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 480), "NOVEMBER 1951: COMBAT EXPLODES", font=fonts['title'], fill=(235, 77, 75), anchor='mm')

    elif ch == 4:
        draw_header(draw, "IV", "Surgery Under Fire: Bullets, Blood, & Textbooks", fonts)
        if line_idx <= 3:
            b = draw_card(draw, cx, cy, 960, 560, bg=(35, 15, 15), outline=(235, 77, 75))
            draw.text((cx, b[1] + 70), "KOREAN WAR COMBAT CASUALTY ALERT", font=fonts['title'], fill=(235, 77, 75), anchor='mm')
            draw.text((cx, b[1] + 150), "HMCS CAYUGA SICKBAY · CODE RED", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw_stamp(draw, cx, b[1] + 250, "16 CRITICAL CASUALTIES", color=(235, 77, 75), fonts=fonts)
            draw.text((cx, b[1] + 350), "PUNCTURED LUNGS · ARTERIAL BLEEDING · SHRAPNEL", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 430), "CAPTAIN: 'DOCTOR CYR, WE NEED YOU IMMEDIATELY!'", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 490), "HE HAD NEVER CUT LIVING FLESH IN HIS LIFE", font=fonts['sub'], fill=(235, 77, 75), anchor='mm')
        elif line_idx <= 7:
            b = draw_card(draw, cx, cy, 960, 560, bg=(20, 25, 38), outline=(0, 210, 211))
            draw.text((cx, b[1] + 70), "PATIENT ZERO: CHEST BULLET", font=fonts['title'], fill=(0, 210, 211), anchor='mm')
            draw.text((cx, b[1] + 140), "BULLET LODGED 12MM FROM HEART", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 400, b[1] + 190, cx + 400, b[1] + 380], radius=14, fill=(10, 15, 25), outline=(235, 77, 75), width=2)
            draw.text((cx, b[1] + 250), "DEMARA: 'PREP PATIENT & GIVE MASSIVE MORPHINE'", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 320), "SPRINTED TO HIS PRIVATE CABIN · LOCKED STEEL DOOR", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 460), "10 MINUTES WITH THE SURGERY MANUAL", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
        elif line_idx <= 11:
            b = draw_card(draw, cx, cy, 960, 560, bg=(15, 35, 30), outline=(46, 204, 113))
            draw.text((cx, b[1] + 70), "THE 10-MINUTE CRAM", font=fonts['title'], fill=(46, 204, 113), anchor='mm')
            draw.text((cx, b[1] + 140), "PHOTOGRAPHIC VISUALIZATION", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 390, b[1] + 190, cx + 390, b[1] + 370], radius=12, fill=(8, 22, 18), outline=(46, 204, 113), width=2)
            draw.text((cx, b[1] + 250), "MAPPING EVERY INTERCOSTAL ARTERY", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 310), "MEMORIZING SUTURE DEPTHS & PERICARDIUM MARGINS", font=fonts['sub'], fill=(220, 240, 230), anchor='mm')
            draw.text((cx, b[1] + 460), "RETURNED TO SICKBAY RADIATING ABSOLUTE CALM", font=fonts['head'], fill=(255, 255, 255), anchor='mm')
        elif line_idx <= 15:
            b = draw_card(draw, cx, cy, 980, 560, bg=(25, 20, 35), outline=(255, 212, 59))
            draw.text((cx, b[1] + 65), "SURGERY UNDER THE KNIFE", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "THE BULLET EXTRACTION", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 420, b[1] + 190, cx + 420, b[1] + 380], radius=12, fill=(15, 12, 22), outline=(255, 212, 59), width=2)
            draw.text((cx, b[1] + 250), "STEADY HANDS: FORCEPS EXTRACT LEAD NEAR HEART", font=fonts['head'], fill=(0, 210, 211), anchor='mm')
            draw.text((cx, b[1] + 310), "FLOODED CAVITY WITH REVOLUTIONARY PENICILLIN DOSE", font=fonts['sub'], fill=(46, 204, 113), anchor='mm')
            draw_stamp(draw, cx, b[1] + 470, "MIRACLE BULLET REMOVED", color=(46, 204, 113), fonts=fonts)
        else:
            b = draw_card(draw, cx, cy, 980, 570, bg=(15, 30, 45), outline=(46, 204, 113))
            draw.text((cx, b[1] + 65), "19-HOUR SURGICAL MARATHON", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "16 PATIENTS · 16 COMPLEX SURGERIES", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 410, b[1] + 190, cx + 410, b[1] + 390], radius=12, fill=(10, 20, 32), outline=(46, 204, 113), width=2)
            draw.text((cx, b[1] + 250), "AMPUTATIONS · SUTURES · TRAUMA RESCUE", font=fonts['sub'], fill=(220, 230, 245), anchor='mm')
            draw.text((cx, b[1] + 320), "ALL 16 CRITICALLY WOUNDED MEN SURVIVED", font=fonts['head'], fill=(46, 204, 113), anchor='mm')
            draw_stamp(draw, cx, b[1] + 475, "ZERO FATALITIES · 100% SURVIVAL", color=(46, 204, 113), fonts=fonts)

    elif ch == 5:
        draw_header(draw, "V", "A Mother's Shock, The Escape, & The Legend", fonts)
        if line_idx <= 2:
            b = draw_card(draw, cx, cy, 960, 560, bg=(245, 240, 225), outline=(30, 45, 75))
            draw.rectangle([b[0], b[1], b[2], b[1] + 70], fill=(20, 20, 20))
            draw.text((cx, b[1] + 35), "CANADIAN PRESS WIRE SERVICE · NOVEMBER 1951", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 130), "THE MIRACLE DOCTOR OF HMCS CAYUGA!", font=fonts['serif_head'], fill=(185, 28, 28), anchor='mm')
            draw.text((cx, b[1] + 210), "CANADIAN HERO SAVES 16 UNDER HEAVY FIRE", font=fonts['head'], fill=(25, 35, 50), anchor='mm')
            draw_stamp(draw, cx, b[1] + 320, "NATIONAL HERO", color=(30, 130, 60), fonts=fonts)
            draw.text((cx, b[1] + 430), "FRONT PAGE HEADLINES ACROSS NORTH AMERICA", font=fonts['sub'], fill=(70, 70, 70), anchor='mm')
            draw.text((cx, b[1] + 490), "FEATURING A SMILING PHOTOGRAPH IN FULL UNIFORM", font=fonts['sub'], fill=(24, 43, 73), anchor='mm')
        elif line_idx <= 7:
            b = draw_card(draw, cx, cy, 940, 560, bg=(245, 238, 220), outline=(180, 40, 40))
            draw.rectangle([b[0], b[1], b[2], b[1] + 70], fill=(120, 30, 30))
            draw.text((cx, b[1] + 35), "QUEBEC, CANADA · MORNING COFFEE", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
            draw.text((cx, b[1] + 130), "A MOTHER'S SHOCK", font=fonts['serif_head'], fill=(20, 20, 20), anchor='mm')
            draw.text((cx, b[1] + 210), "MRS. CYR OPENS THE NEWSPAPER", font=fonts['head'], fill=(50, 50, 50), anchor='mm')
            draw.rounded_rectangle([cx - 390, b[1] + 260, cx + 390, b[1] + 420], radius=12, fill=(235, 220, 200), outline=(160, 50, 50), width=2)
            draw.text((cx, b[1] + 310), "'THIS MAN IS A HERO...'", font=fonts['head'], fill=(40, 40, 40), anchor='mm')
            draw.text((cx, b[1] + 370), "'...BUT THAT IS DEFINITELY NOT MY SON!'", font=fonts['title'], fill=(185, 28, 28), anchor='mm')
            draw_stamp(draw, cx, b[1] + 480, "FRAUD EXPOSED", color=(185, 28, 28), fonts=fonts)
        elif line_idx <= 13:
            b = draw_card(draw, cx, cy, 960, 560, bg=(20, 30, 48), outline=(255, 212, 59))
            draw.text((cx, b[1] + 65), "NAVAL HIGH COMMAND PANIC", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "THE ULTIMATE MILITARY EMBARRASSMENT", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
            draw.rounded_rectangle([cx - 410, b[1] + 190, cx + 410, b[1] + 380], radius=12, fill=(12, 18, 30), outline=(255, 212, 59), width=2)
            draw.text((cx, b[1] + 250), "NO COURT-MARTIAL · TO AVOID INTERNATIONAL SCANDAL", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 310), "QUIETLY DISCHARGED HIM · PAID HIS SALARY · GAVE HIM TRAIN FARE", font=fonts['sub'], fill=(220, 220, 220), anchor='mm')
            draw_stamp(draw, cx, b[1] + 470, "QUIETLY DISMISSED // NO CHARGES", color=(0, 210, 211), fonts=fonts)
        elif line_idx <= 17:
            b = draw_card(draw, cx, cy, 980, 570, bg=(25, 20, 35), outline=(255, 212, 59))
            draw.text((cx, b[1] + 65), "THE SPREE CONTINUES", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.rounded_rectangle([cx - 420, b[1] + 120, cx + 420, b[1] + 440], radius=12, fill=(14, 10, 20), outline=(180, 150, 80), width=2)
            draw.text((cx, b[1] + 170), "1. TEXAS MAXIMUM SECURITY PRISON WARDEN", font=fonts['head'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 230), "   (REFORMED INMATE CONDITIONS & SLASHED VIOLENCE!)", font=fonts['sub'], fill=(46, 204, 113), anchor='mm')
            draw.text((cx, b[1] + 290), "2. CANCER RESEARCH SCIENTIST", font=fonts['head'], fill=(0, 210, 211), anchor='mm')
            draw.text((cx, b[1] + 350), "3. CIVIL ENGINEER & BAPTIST PARISH CHAPLAIN", font=fonts['head'], fill=(220, 220, 220), anchor='mm')
            draw.text((cx, b[1] + 410), "HOLLYWOOD FILM: 'THE GREAT IMPOSTER' (TONY CURTIS, 1961)", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 500), "AN AUDACIOUS LEGEND LIKE NO OTHER", font=fonts['serif_head'], fill=(255, 255, 255), anchor='mm')
        else:
            b = draw_card(draw, cx, cy, 960, 560, bg=(15, 22, 35), outline=(255, 212, 59))
            draw.text((cx, b[1] + 70), "FERDINAND WALDO DEMARA", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
            draw.text((cx, b[1] + 140), "1921 — 1982", font=fonts['serif_head'], fill=(200, 210, 225), anchor='mm')
            draw.rounded_rectangle([cx - 400, b[1] + 190, cx + 400, b[1] + 380], radius=12, fill=(10, 15, 25), outline=(255, 212, 59), width=2)
            draw.text((cx, b[1] + 250), "NO MEDICAL DEGREE · NO FORMAL EDUCATION", font=fonts['head'], fill=(235, 77, 75), anchor='mm')
            draw.text((cx, b[1] + 310), "SAVED 16 LIVES UNDER FIRE ON THE HIGH SEAS", font=fonts['head'], fill=(46, 204, 113), anchor='mm')
            draw_stamp(draw, cx, b[1] + 465, "THE GREAT IMPOSTER", color=(255, 212, 59), fonts=fonts)

def draw_subtitles(draw, text, fonts):
    y = 920
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
        draw.text((WIDTH // 2, line_y), l_text, font=fonts['cap'], fill=(255, 255, 255), anchor='mm', stroke_width=9, stroke_fill=(11, 11, 16))
        line_y += 65

def pre_render_lines(ch_num, lines, fonts, base_bg):
    print(f"Pre-rendering {len(lines)} line scenes for Chapter {ch_num}...")
    line_images = []
    for i, line in enumerate(lines):
        im = base_bg.copy()
        draw = ImageDraw.Draw(im)
        draw_scene(draw, ch_num, i, line['text'], fonts)
        draw_subtitles(draw, line['text'], fonts)
        line_images.append(im.tobytes())
    return line_images

def render_chapter_video_fast(ch_num):
    lines_path = os.path.join(ROOT, 'chapters', f'ch{ch_num}_lines.json')
    wav_path = os.path.join(ROOT, 'chapters', f'ch{ch_num}_narration.wav')
    out_mp4 = os.path.join(ROOT, 'renders', f'ch{ch_num}.mp4')
    
    with open(lines_path, 'r', encoding='utf-8') as f:
        lines_data = json.load(f)
    
    lines = lines_data.get('lines', [])
    dur = lines_data.get('duration', lines[-1]['end'] if lines else 60.0)
    total_frames = int(dur * FPS) + 12
    
    print(f"\n==========================================")
    print(f"⚡ FAST RENDERING CHAPTER {ch_num} ({dur:.2f}s, {total_frames} frames)")
    print(f"==========================================")
    
    fonts = get_fonts()
    base_bg = create_base_background()
    line_byte_cache = pre_render_lines(ch_num, lines, fonts, base_bg)
    
    cmd = [
        'ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo',
        '-s', f'{WIDTH}x{HEIGHT}', '-pix_fmt', 'rgb24', '-r', str(FPS),
        '-i', '-',
        '-i', wav_path,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-shortest', '-movflags', '+faststart',
        out_mp4
    ]
    
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t0 = time.time()
    last_line_idx = 0
    
    for frame_idx in range(total_frames):
        t = frame_idx / FPS
        while last_line_idx < len(lines) - 1 and t >= lines[last_line_idx + 1]['start']:
            last_line_idx += 1
        
        p.stdin.write(line_byte_cache[last_line_idx])
        
    p.stdin.close()
    p.wait()
    dt = time.time() - t0
    speed = total_frames / max(0.1, dt)
    size_mb = os.path.getsize(out_mp4) / (1024 * 1024)
    print(f"✅ Rendered ch{ch_num}.mp4: {size_mb:.2f} MB in {dt:.1f}s ({speed:.1f} fps)!")
    return out_mp4

def render_outro(dur=25.0):
    out_mp4 = os.path.join(ROOT, 'renders', 'outro.mp4')
    total_frames = int(dur * FPS)
    fonts = get_fonts()
    base_bg = create_base_background()
    
    im = base_bg.copy()
    draw = ImageDraw.Draw(im)
    cx, cy = WIDTH // 2, 480
    draw_card(draw, cx, cy, 1000, 600, bg=(15, 23, 42), outline=(255, 212, 59))
    draw.text((cx, cy - 200), "ANIMATED CREW", font=fonts['title'], fill=(255, 212, 59), anchor='mm')
    draw.text((cx, cy - 120), "UNBELIEVABLE TRUE STORIES FROM HISTORY", font=fonts['sub'], fill=(0, 210, 211), anchor='mm')
    
    btn_w, btn_h = 520, 96
    draw.rounded_rectangle([cx - btn_w // 2, cy - 20 - btn_h // 2, cx + btn_w // 2, cy - 20 + btn_h // 2], radius=22, fill=(220, 38, 38))
    draw.text((cx, cy - 20), "SUBSCRIBE FOR MORE", font=fonts['head'], fill=(255, 255, 255), anchor='mm')
    
    draw.text((cx, cy + 90), "👍 LIKE THIS VIDEO IF YOU ENJOYED THE STORY!", font=fonts['sub'], fill=(255, 255, 255), anchor='mm')
    draw.text((cx, cy + 150), "NEXT EPISODE: The Man Who Sold the Eiffel Tower (Twice!)", font=fonts['sub'], fill=(255, 212, 59), anchor='mm')
    draw.text((cx, cy + 220), "Comment below: Would you let Demara operate on you?", font=fonts['serif_body'], fill=(180, 200, 225), anchor='mm')
    buf = im.tobytes()
    
    cmd = [
        'ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo',
        '-s', f'{WIDTH}x{HEIGHT}', '-pix_fmt', 'rgb24', '-r', str(FPS),
        '-i', '-',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-t', str(dur), '-movflags', '+faststart',
        out_mp4
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(total_frames):
        p.stdin.write(buf)
    p.stdin.close()
    p.wait()
    print(f"✅ Rendered outro.mp4 ({dur}s)")
    return out_mp4

def assemble_master():
    print(f"\n==========================================")
    print(f"🎬 STITCHING MASTER FULL-LENGTH VIDEO VIA FILTER_COMPLEX")
    print(f"==========================================")
    renders_dir = os.path.join(ROOT, 'renders')
    ch_files = [
        os.path.join(renders_dir, 'ch1.mp4'),
        os.path.join(renders_dir, 'ch2.mp4'),
        os.path.join(renders_dir, 'ch3.mp4'),
        os.path.join(renders_dir, 'ch4.mp4'),
        os.path.join(renders_dir, 'ch5.mp4'),
        os.path.join(renders_dir, 'outro.mp4')
    ]
    
    for f in ch_files:
        if not os.path.exists(f):
            raise FileNotFoundError(f"Missing chapter video: {f}")

    full_mp4 = os.path.join(renders_dir, 'full.mp4')
    
    # Build filter_complex command
    cmd = ['ffmpeg', '-y']
    for f in ch_files:
        cmd.extend(['-i', f])
        
    n = len(ch_files)
    inputs_filter = ''.join([f'[{i}:v:0][{i}:a:0]' for i in range(n)])
    filter_graph = f"{inputs_filter}concat=n={n}:v=1:a=1[v][a]"
    
    cmd.extend([
        '-filter_complex', filter_graph,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart',
        full_mp4
    ])
    
    print(f"Running master concatenation on {n} chapters...")
    t0 = time.time()
    subprocess.run(cmd, check=True)
    dt = time.time() - t0
    
    # Probe final output
    probe = subprocess.run([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration,size',
        '-of', 'json', full_mp4
    ], capture_output=True, text=True, check=True)
    meta = json.loads(probe.stdout)['format']
    total_dur = float(meta['duration'])
    total_mb = float(meta['size']) / (1024 * 1024)
    mins = int(total_dur // 60)
    secs = int(total_dur % 60)
    
    print(f"\n🎉 FULL MASTER CREATED SUCCESSFULLY in {dt:.1f}s!")
    print(f"File: {full_mp4}")
    print(f"Duration: {mins}:{secs:02d} ({total_dur:.2f}s)")
    print(f"Size: {total_mb:.2f} MB")
    
    return full_mp4, total_dur, total_mb

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if mode in ['2', '3', '4', '5']:
        render_chapter_video_fast(int(mode))
    elif mode == 'outro':
        render_outro()
    elif mode == 'assemble':
        assemble_master()
    elif mode == 'all':
        for c in [3, 4, 5]:
            render_chapter_video_fast(c)
        render_outro()
        assemble_master()
