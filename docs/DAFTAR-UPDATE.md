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

5. **Bagikan sebagai PDF (Word, Excel, PowerPoint)**
   - Kondisi sekarang: Bagikan hanya bisa sebagai file asli.
   - Yang diinginkan: menu Bagikan punya dua pilihan, "Bagikan file asli" dan "Bagikan sebagai PDF".
   - Cara (disepakati): jalur otomatis memakai pencetak PDF bawaan Android (cetak dari WebView), tanpa pustaka tambahan. Saat Bapak memilih "Bagikan sebagai PDF", muncul layar loading, lalu setelah PDF siap, menu bagikan Android terbuka.
   - Yang perlu diperhatikan: hasil PDF mengikuti tampilan di penampil (pemotongan halaman Word, tabel Excel yang lebar, satu slide per halaman untuk PowerPoint). Nama file PDF mengikuti nama dokumen asli (sejalan dengan butir 1). Perlu diuji di HP, terutama dokumen panjang.
   - Ukuran: sedang. Berkaitan dengan butir 1 dan 4.

6. **Bagian Tentang: nama pembuat**
   - Tulis "Guru SMA Negeri 3 Maliku" di bawah nama pembuat pada bagian Tentang, bila belum sesuai.
   - Dikerjakan pada update berikutnya.

## Catatan

- Sebelum rilis ke Play Store: `versionCode` harus lebih besar dari rilis sebelumnya. Alur rilis ada di `.github/workflows/release-tg-office-play.yml` (cara alur itu menentukan `versionCode` belum diperiksa).
