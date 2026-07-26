import 'package:file_saver/file_saver.dart';
import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';
import '../../core/storage/encrypted_message_cache.dart';

class MessageStorageSettingsScreen extends StatefulWidget {
  const MessageStorageSettingsScreen({
    super.key,
    required this.client,
    this.cache,
    this.cacheError,
  });

  final AvsApiClient client;
  final EncryptedMessageCache? cache;
  final Object? cacheError;

  @override
  State<MessageStorageSettingsScreen> createState() =>
      _MessageStorageSettingsScreenState();
}

class _MessageStorageSettingsScreenState
    extends State<MessageStorageSettingsScreen> {
  bool _loading = true;
  bool _busy = false;
  bool _images = true;
  bool _documents = false;
  bool _keepOnLogout = false;
  int _size = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final cache = widget.cache;
    if (cache != null) {
      final values = await Future.wait([
        cache.preferences(),
        cache.approximateSizeBytes(),
      ]);
      final preferences = values[0] as LocalCachePreference;
      _images = preferences.autoDownloadImages;
      _documents = preferences.autoDownloadDocuments;
      _keepOnLogout = preferences.keepOnLogout;
      _size = values[1] as int;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _savePreferences() async {
    final cache = widget.cache;
    if (cache == null) return;
    await cache.setPreferences(
      autoDownloadImages: _images,
      autoDownloadDocuments: _documents,
      keepOnLogout: _keepOnLogout,
    );
    _message('Encrypted cache preferences saved.');
  }

  Future<void> _clear() async {
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear messages from this device?'),
        content: const Text(
          'This removes encrypted conversation copies, drafts, and pending operations from this device only. Server messages are not deleted.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Clear device cache'),
          ),
        ],
      ),
    );
    if (approved != true) return;
    await widget.cache?.clear();
    await _load();
    _message('The encrypted device cache was cleared.');
  }

  Future<void> _backup() async {
    final password = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create encrypted message backup'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter your current password. The export is encrypted before it leaves the server and contains only conversations you may access.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: password,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Current password'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, password.text),
            child: const Text('Encrypt and export'),
          ),
        ],
      ),
    );
    password.clear();
    if (value == null || value.length < 8) return;
    setState(() => _busy = true);
    try {
      final download = await widget.client.postBytes(
        '/messages/backup/export',
        {'currentPassword': value},
      );
      await FileSaver.instance.saveFile(
        name: download.fileName ?? 'avs-message-backup.avs.json',
        bytes: download.bytes,
        includeExtension: false,
        mimeType: MimeType.custom,
        customMimeType: 'application/json',
      );
      _message('Encrypted backup exported.');
    } catch (error) {
      _message(
        error is AvsApiException
            ? error.message
            : 'The encrypted backup could not be created.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Message storage and backup')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (widget.cache == null)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.warning_amber_rounded),
                      title: const Text('Offline cache unavailable'),
                      subtitle: Text(
                        widget.cacheError?.toString() ??
                            'This platform could not open the encrypted database.',
                      ),
                    ),
                  )
                else ...[
                  ListTile(
                    leading: const Icon(Icons.lock_outline),
                    title: const Text('Encrypted device cache'),
                    subtitle: Text(_formatSize(_size)),
                  ),
                  SwitchListTile(
                    value: _images,
                    onChanged: (value) => setState(() => _images = value),
                    title: const Text('Auto-download image previews'),
                    subtitle: const Text('Only on a successful authenticated sync.'),
                  ),
                  SwitchListTile(
                    value: _documents,
                    onChanged: (value) => setState(() => _documents = value),
                    title: const Text('Auto-download documents'),
                    subtitle: const Text('Off by default to limit device storage.'),
                  ),
                  SwitchListTile(
                    value: _keepOnLogout,
                    onChanged: (value) => setState(() => _keepOnLogout = value),
                    title: const Text('Keep encrypted cache after sign out'),
                    subtitle: const Text(
                      'When off, sign out clears messages and drafts from this device.',
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: _savePreferences,
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('Save cache preferences'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _clear,
                    icon: const Icon(Icons.cleaning_services_outlined),
                    label: const Text('Clear this device cache'),
                  ),
                ],
                const Divider(height: 40),
                ListTile(
                  leading: const Icon(Icons.enhanced_encryption_outlined),
                  title: const Text('Encrypted server backup'),
                  subtitle: const Text(
                    'Password-verified AES-256-GCM export of messages you are authorized to access.',
                  ),
                ),
                FilledButton.icon(
                  onPressed: _busy ? null : _backup,
                  icon: _busy
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.download_outlined),
                  label: const Text('Create encrypted backup'),
                ),
              ],
            ),
    );
  }

  String _formatSize(int bytes) {
    if (bytes >= 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB stored locally';
    }
    return '${(bytes / 1024).toStringAsFixed(1)} KB stored locally';
  }

  void _message(String value) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}
