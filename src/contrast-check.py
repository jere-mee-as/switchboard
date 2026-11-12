# Contrast check: run 'node contrast-shots.js' first, then this. Lists text below 4.5:1 (3:1 large) against the real pixels behind it.
import json, glob, os, sys
from PIL import Image
def L(c):
    f=lambda v:(v/255)/12.92 if v/255<=0.03928 else ((v/255+0.055)/1.055)**2.4
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
def ratio(a,b):
    x,y=L(a),L(b); return (max(x,y)+0.05)/(min(x,y)+0.05)
res=[]
for jf in sorted(glob.glob('' + os.path.join(os.path.dirname(os.path.abspath(__file__)), 'contrast-out') + '/*.json')):
    st=os.path.basename(jf)[:-5]; im=Image.open(jf[:-5]+'.png').convert('RGB'); W,H=im.size; P=im.load()
    for it in json.load(open(jf)):
        import re
        m=[float(v) for v in re.findall(r'[\d.]+',it['color'])]
        if it['color'].startswith('color('): m=[v*255 for v in m[:3]]+m[3:]
        tc=m[:3]; ta=(m[3] if len(m)>3 else 1)*it['op']
        x,y,w,h=it['r']; s=[]
        for i in range(9):
            for j in range(5):
                xx=min(W-1,max(0,round(x+w*i/8))); yy=min(H-1,max(0,round(y+h*j/4))); s.append(P[xx,yy])
        far=[c for c in s if ratio(c,tc)>1.15] or s
        far.sort(key=L); bg=far[len(far)//2]
        eff=[tc[k]*ta+bg[k]*(1-ta) for k in range(3)]
        cr=ratio(eff,bg); large=it['size']>=24 or (it['size']>=18.66 and it['weight']>=700); need=3 if large else 4.5
        if cr<need: res.append((round(cr,2),need,st,it['cls'],it['txt'],it['color'],bg))
best={}
for r in res:
    k=(r[3],r[2].split('_')[0]+'_'+r[2].split('_')[1])
    if k not in best or best[k][0]>r[0]: best[k]=r
out=sorted(best.values())
print(len(out),'failing (element x theme/wallpaper)')
for r in out: print(f"{r[0]:5} (need {r[1]}) | {r[2]} | {r[3][:60]} | \"{r[4][:28]}\" | {r[5]} on {r[6]}")
