#!/bin/bash
# fetch.sh kind(notice|notice_award) year month -> data/<kind>_<y>_<m>.jsonl
k=$1;y=$2;m=$3; f=/tmp/rhr_${k}_${y}_${m}.xml; out=data/${k}_${y}_${m}.jsonl
[ -s "$out" ] && exit 0
curl -sS -m 300 --retry 3 -o "$f" "https://riigihanked.riik.ee/rhr/api/public/v1/opendata/$k/$y/month/$m/xml" || exit 1
kind=notice; [ "$k" = notice_award ] && kind=award
python3 rhr_parse.py "$f" $kind > "$out" 2>>data/err.log; rm -f "$f"; echo "$out $(wc -l < $out)"
