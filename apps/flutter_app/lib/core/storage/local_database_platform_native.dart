import 'dart:io';

import 'package:drift_flutter/drift_flutter.dart';

Future<void> configureLocalDatabasePlatform() async {
  if (!Platform.isAndroid &&
      !Platform.isIOS &&
      !Platform.isWindows &&
      !Platform.isLinux &&
      !Platform.isMacOS) {
    throw UnsupportedError('Encrypted local storage is unavailable.');
  }
}

DriftNativeOptions encryptedNativeOptions(String keyHex) {
  return DriftNativeOptions(
    setup: (database) {
      database.execute('PRAGMA key = "x\'$keyHex\'";');
      final sqlCipher = database.select('PRAGMA cipher_version;');
      final multipleCiphers = database.select('PRAGMA cipher;');
      if (sqlCipher.isEmpty && multipleCiphers.isEmpty) {
        throw StateError(
          'SQLCipher is unavailable. The message cache will not be opened as plaintext.',
        );
      }
      database.execute('PRAGMA foreign_keys = ON;');
      database.execute('PRAGMA secure_delete = ON;');
    },
  );
}
