import json, random, math, sys
from PIL import Image, ImageDraw, ImageFont
random.seed(7)
W,H=1170,1500
img=Image.new("RGB",(W,H),(250,250,252))
d=ImageDraw.Draw(img)
f=ImageFont.load_default(34); fb=ImageFont.load_default(46)
d.text((W//2-150,140),"novembro 2026",font=fb,fill=(20,20,20))
COL={'work':(244,163,163),'off_mand':(155,123,224),'off_comp':(169,212,245),'holiday_closed':(168,36,47)}
p=150; x0=105+p//2; y0=330
first=6 # 1 nov 2026 = domingo, semana começa à segunda
truth={}; words=[]
types=['work']*14+['off_mand']*4+['off_comp']*4+['holiday_closed']
swaps={5:'work',12:'off_comp',19:'work',26:'work'}
for day in range(1,31):
    i=first+day-1; r,c=divmod(i,7)
    cx=x0+c*p; cy=y0+r*165
    t=random.choice(types)
    if day in swaps: t=swaps[day]
    if t=='holiday_closed' and day!=1: pass
    if day==1: t='holiday_closed'
    rad=52
    d.ellipse([cx-rad,cy-rad,cx+rad,cy+rad],fill=COL[t])
    swap=day in swaps
    if swap:
        R=rad+9
        for k in range(0,360,20):
            d.arc([cx-R,cy-R,cx+R,cy+R],k,k+11,fill=(90,90,90),width=3)
    s=str(day); tw=d.textlength(s,font=f)
    tc=(255,255,255) if t in('holiday_closed','off_mand') else (30,30,30)
    d.text((cx-tw/2,cy-17),s,font=f,fill=tc)
    truth[day]={'type':t,'swap':swap}
    words.append({'text':s,'x0':cx-tw/2,'x1':cx+tw/2,'y0':cy-17+4,'y1':cy+17+2,'conf':90})
drop=random.sample(range(len(words)),4)
dropped=[int(words[i]['text']) for i in drop]
words=[w for i,w in enumerate(words) if i not in drop]
img.save("test/synth.png")
json.dump({'words':words,'truth':truth,'text':'novembro 2026\nS T Q Q S S D','dropped':dropped},open("test/synth.json","w"))
print("dropped",dropped)
