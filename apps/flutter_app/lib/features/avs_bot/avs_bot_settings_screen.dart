import 'package:flutter/material.dart';

import 'avs_bot_repository.dart';

class AvsBotSettingsScreen extends StatefulWidget {
  const AvsBotSettingsScreen({super.key, required this.repository});

  final AvsBotRepository repository;

  @override
  State<AvsBotSettingsScreen> createState() => _AvsBotSettingsScreenState();
}

class _AvsBotSettingsScreenState extends State<AvsBotSettingsScreen> {
  Map<String, dynamic>? _settings;
  Object? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final value = await widget.repository.settings();
      if (mounted) setState(() => _settings = value);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _set(String key, dynamic value) async {
    setState(() {
      _saving = true;
      _settings = {...?_settings, key: value};
    });
    try {
      final updated = await widget.repository.updateSettings({key: value});
      if (mounted) setState(() => _settings = updated);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
        await _load();
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    return Scaffold(
      appBar: AppBar(
        title: const Text('AVS Bot preferences'),
        actions: [
          if (_saving)
            const Padding(
              padding: EdgeInsets.all(16),
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
        ],
      ),
      body: _error != null
          ? Center(child: Text('Could not load preferences: $_error'))
          : settings == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                DropdownButtonFormField<String>(
                  initialValue: settings['language']?.toString() ?? 'AUTO',
                  decoration: const InputDecoration(
                    labelText: 'Response language',
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'AUTO',
                      child: Text('Match my language'),
                    ),
                    DropdownMenuItem(value: 'ENGLISH', child: Text('English')),
                    DropdownMenuItem(value: 'TAMIL', child: Text('Tamil')),
                  ],
                  onChanged: (value) {
                    if (value != null) _set('language', value);
                  },
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  initialValue:
                      settings['responseLength']?.toString() ?? 'BALANCED',
                  decoration: const InputDecoration(
                    labelText: 'Response length',
                  ),
                  items: const [
                    DropdownMenuItem(value: 'SHORT', child: Text('Short')),
                    DropdownMenuItem(
                      value: 'BALANCED',
                      child: Text('Balanced'),
                    ),
                    DropdownMenuItem(
                      value: 'DETAILED',
                      child: Text('Detailed'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) _set('responseLength', value);
                  },
                ),
                SwitchListTile(
                  value: settings['showSources'] as bool? ?? true,
                  title: const Text('Show knowledge sources'),
                  onChanged: (value) => _set('showSources', value),
                ),
                SwitchListTile(
                  value: settings['saveHistory'] as bool? ?? true,
                  title: const Text('Save server conversation history'),
                  subtitle: const Text(
                    'Turn off to replace stored prompt and response content after each request.',
                  ),
                  onChanged: (value) => _set('saveHistory', value),
                ),
                SwitchListTile(
                  value: settings['keepLocalCache'] as bool? ?? true,
                  title: const Text('Keep encrypted offline cache'),
                  onChanged: (value) => _set('keepLocalCache', value),
                ),
                SwitchListTile(
                  value: settings['autoTitle'] as bool? ?? true,
                  title: const Text('Automatically title conversations'),
                  onChanged: (value) => _set('autoTitle', value),
                ),
              ],
            ),
    );
  }
}
