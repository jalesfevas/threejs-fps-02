# ATURAN KERJA make.fun (otomatis terbaca saat bekerja di direktori ini)

Berkas ini ada supaya aturan tidak bergantung ingatan agen. Hermes (dan sesi build apa pun di
direktori ini) WAJIB mematuhinya. Versi panjang: skill `agent-bounty-platforms`.

## Sebelum bertindak
1. Muat skill `agent-bounty-platforms` (skill_view) sebelum keputusan apa pun soal bounty — jangan
   bekerja dari ingatan sesi.
2. Tidak ada klaim tanpa data: output tool, state API, atau on-chain. Yang belum diukur = "tidak
   terbukti". Dilarang menulis "seharusnya/mestinya" sebagai pengganti angka.

## Aksi terjadwal
3. Cron/scheduler = NIAT, bukan KEJADIAN. Setelah waktu tembak: cek `hermes cron runs <id>` DAN efek
   nyatanya (entri baru di `/api/agents/me`, berkas berubah). Sebelum itu, dilarang bilang "sudah".
4. Tabel status yang menunjukkan "yang seharusnya terjadi tidak terjadi" (kuota tak naik, baris entri
   tidak muncul) = ALARM. Baca, jangan lewati.
5. Aksi murah yang bisa langsung → lakukan langsung. Jangan dijadwalkan.

## Submit
6. Submit HANYA lewat `makefun/tools/submit_safe.sh` (bundle → check wajib pass → submit → verifikasi
   `/api/agents/me` berisi submission id baru). Kalau satu langkah gagal, skrip berhenti — jangan
   bypass, jangan submit manual dengan curl sendiri.
7. Sebelum submit: `check` harus 0 FAIL. Setelah submit: bukti = receipt + baris entri di
   `/api/agents/me` + (kalau ada) rank di papan dev. Sampaikan ketiganya, bukan hanya salah satu.

## Uang & kunci
8. Nol transaksi on-chain, nol deposit, nol klaim tanpa perintah eksplisit pemilik.
9. Kunci tidak pernah dicetak, tidak pernah jadi argumen shell; hanya path berkas.
10. Hadiah di escrow belum adalah uang di wallet: buktikan on-chain sebelum menyebut angka "diterima".
11. Sesi build (apa pun artefaknya) BELUM selesai sampai inti loop-nya teruji sukses:
    untuk game = simulasi satu pertandingan penuh dan PEMBEBANJIN bisa menang minimal
    satu ronde (bukan hanya tidak crash); untuk pipeline = satu submit nyata
    terverifikasi di /api/agents/me; untuk gate = satu kasus pass + satu kasus gagal.
    "Syntax pass + server 200" BUKAN definisi selesai. Lapor hasil uji inti ini
    bersama laporan sesi — tanpa itu, status sesi = "belum diverifikasi".
