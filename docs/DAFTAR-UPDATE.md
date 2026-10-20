# Daftar Update TeGe Office

Dicatat: 20 Oktober 2026. Status: **belum dikerjakan** (menunggu perintah "Update Kode").

## Perbaikan bug

1. **Nama file PDF berubah saat dibagikan**
   - Gejala: PDF yang dibagikan lewat menu Bagikan selalu bernama `tg-pdf-lab-share.pdf`.
   - Lokasi: `app/src/main/java/com/totogutomo/tgpdflab/MainActivity.java`, fungsi `shareCurrent`.
   - Saran: pakai nama asli file saat menyalin ke berkas sementara.

2. **Tombol Back di Pengaturan keluar aplikasi**
   - Gejala: Back di Pengaturan menutup aplikasi. Seharusnya kembali ke beranda. Back di beranda perlu menampilkan konfirmasi keluar.
   - Lokasi: `TG-Office-Integrated/app/src/main/java/com/totogutomo/tgoffice/MainActivity.java` (`onBackPressed`) dan `assets/web/js/app.js` (`__TG_BACK__`).
   - Dugaan: aplikasi target Android 36, sehingga `onBackPressed` lama kemungkinan tidak dipanggil sistem. Perlu diuji di HP.
   - Catatan: konfirmasi keluar di beranda belum ada.

3. **Gambar transparan tidak terbaca di penampil DOCX**
   - Gejala: tanda tangan tidak tampak dan latar putih gambar menutupi teks di bawahnya (contoh: SK piket guru PJJ dengan stempel).
   - Penyebab: gambar JPEG memakai pengaturan "warna transparan" Word (`clrChange`), dan penampil belum membacanya.
   - Lokasi: `TG-Office-Integrated/app/src/main/assets/web/js/viewers/docx.js` (bagian gambar, fungsi `_drawing`).
   - Saran: hilangkan warna yang ditandai transparan saat gambar ditampilkan. Berkas contoh: `SK_piket_guru_PJJ_stempel.docx`.

## Peningkatan

4. **Menu "Bagikan" saat judul file ditekan**
   - Judul file di penampil (`viewerFileName`) saat ini hanya teks. Hubungkan ke fungsi bagikan yang sudah ada.

## Catatan

- Sebelum rilis ke Play Store: `versionCode` harus lebih besar dari rilis sebelumnya. Alur rilis ada di `.github/workflows/release-tg-office-play.yml` (cara alur itu menentukan `versionCode` belum diperiksa).
- Pada update berikutnya, bagian Tentang perlu menuliskan "Guru SMA Negeri 3 Maliku" di bawah nama pembuat bila belum sesuai.
