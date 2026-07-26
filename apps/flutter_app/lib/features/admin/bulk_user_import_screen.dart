import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:file_saver/file_saver.dart';
import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';

class BulkUserImportScreen extends StatefulWidget {
  const BulkUserImportScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  State<BulkUserImportScreen> createState() => _BulkUserImportScreenState();
}

class _BulkUserImportScreenState extends State<BulkUserImportScreen> {
  static const _types = <String, String>{
    'STUDENTS': 'Student accounts',
    'STAFF': 'Faculty, HOD and staff accounts',
    'USERS': 'Mixed people and profile updates',
    'DEPARTMENTS': 'Departments',
    'PROGRAMMES': 'Programmes',
    'CLASSES': 'Sections / classes',
    'ATTENDANCE': 'Period attendance records',
    'BLOCKS': 'Campus blocks',
    'FLOORS': 'Campus floors',
    'ROOMS': 'Classrooms and rooms',
    'ASSETS': 'Campus assets',
    'RESPONSIBLE_PERSONS': 'Maintenance responsibility',
    'ASSIGNMENT_RULES': 'Issue assignment rules',
  };
  static const _roles = [
    'FACULTY',
    'HOD',
    'CLASS_COORDINATOR',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'MAINTENANCE_ADMIN',
    'MAINTENANCE_SUPERVISOR',
    'MAINTENANCE_STAFF',
    'ELECTRICIAN',
    'PLUMBER',
    'IT_SUPPORT',
    'LAB_TECHNICIAN',
    'HOUSEKEEPING',
    'SECURITY',
    'OTHER_RESPONSIBLE',
  ];

  PlatformFile? _file;
  String _entityType = 'STUDENTS';
  String _selectedRole = 'FACULTY';
  String _mode = 'VALIDATE_ONLY';
  String _studyYear = '';
  String _duplicateResolution = 'KEEP_FIRST';
  Map<String, String> _departmentMappings = {};
  Map<String, dynamic>? _preview;
  Map<String, dynamic>? _job;
  bool _busy = false;
  String? _error;
  Timer? _poller;

  @override
  void dispose() {
    _poller?.cancel();
    super.dispose();
  }

  Future<void> _pick() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['xlsx', 'xls', 'csv'],
      withData: true,
    );
    if (result == null) return;
    setState(() {
      _file = result.files.single;
      _preview = null;
      _job = null;
      _error = null;
      _departmentMappings = {};
    });
  }

  Future<void> _downloadTemplate() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final file =
          await widget.client.getBytes('/imports/templates/$_entityType');
      await FileSaver.instance.saveFile(
        name: file.fileName ?? '${_entityType.toLowerCase()}-template.xlsx',
        bytes: file.bytes,
        includeExtension: false,
        mimeType: MimeType.custom,
        customMimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (error) {
      _error = '$error';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _validate() async {
    final file = _file;
    if (file?.bytes == null) {
      setState(() => _error = 'Select a workbook first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.postFile(
        '/imports/preview',
        fields: {
          'entityType': _entityType,
          'importMode': _mode,
          if (_entityType == 'STUDENTS') 'selectedRoleCode': 'STUDENT',
          if (_entityType == 'STAFF' || _entityType == 'USERS')
            'selectedRoleCode': _selectedRole,
          'duplicateResolution': _duplicateResolution,
          if (_studyYear.isNotEmpty) 'detectedStudyYear': _studyYear,
          if (_departmentMappings.isNotEmpty)
            'departmentMappings': jsonEncode(_departmentMappings),
        },
        fileName: file!.name,
        bytes: file.bytes!,
      ) as Map<String, dynamic>;
      final inspections =
          result['sheetInspections'] as List<dynamic>? ?? const [];
      setState(() {
        _preview = result;
        _departmentMappings = {
          for (final item in inspections.whereType<Map<String, dynamic>>())
            if (item['mappedDepartmentCode'] is String)
              item['sourceDepartmentCode'] as String:
                  item['mappedDepartmentCode'] as String,
        };
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    final id = (_preview?['job'] as Map<String, dynamic>?)?['id'] as String?;
    if (id == null) return;
    setState(() => _busy = true);
    try {
      await widget.client.post('/imports/$id/confirm', const {});
      _poller?.cancel();
      _poller = Timer.periodic(
        const Duration(seconds: 2),
        (_) => _poll(id),
      );
      await _poll(id);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _poll(String id) async {
    final value =
        await widget.client.get('/imports/$id') as Map<String, dynamic>;
    if (!mounted) return;
    setState(() => _job = value);
    if (['COMPLETED', 'FAILED', 'ROLLED_BACK'].contains(value['status'])) {
      _poller?.cancel();
    }
  }

  @override
  Widget build(BuildContext context) {
    final previewJob = _preview?['job'] as Map<String, dynamic>?;
    final inspections =
        _preview?['sheetInspections'] as List<dynamic>? ?? const [];
    final departments =
        _preview?['departmentOptions'] as List<dynamic>? ?? const [];
    final errors = _preview?['errors'] as List<dynamic>? ?? const [];
    final duplicates =
        _preview?['duplicateGroups'] as List<dynamic>? ?? const [];
    return Scaffold(
      appBar: AppBar(title: const Text('Data Import Centre')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DropdownButtonFormField<String>(
            initialValue: _entityType,
            decoration: const InputDecoration(labelText: 'Import type'),
            items: _types.entries
                .map(
                  (entry) => DropdownMenuItem(
                    value: entry.key,
                    child: Text(entry.value),
                  ),
                )
                .toList(),
            onChanged: _busy
                ? null
                : (value) => setState(() {
                      _entityType = value ?? _entityType;
                      _file = null;
                      _preview = null;
                      _job = null;
                    }),
          ),
          if (_entityType == 'STAFF' || _entityType == 'USERS') ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _selectedRole,
              decoration:
                  const InputDecoration(labelText: 'Role applied to this file'),
              items: _roles
                  .map(
                    (value) => DropdownMenuItem(
                      value: value,
                      child: Text(value.replaceAll('_', ' ')),
                    ),
                  )
                  .toList(),
              onChanged: (value) =>
                  setState(() => _selectedRole = value ?? _selectedRole),
            ),
          ],
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _busy ? null : _downloadTemplate,
            icon: const Icon(Icons.download_outlined),
            label: const Text('Download template'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _busy ? null : _pick,
            icon: const Icon(Icons.file_open),
            label: Text(_file?.name ?? 'Select workbook'),
          ),
          if (_file != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('${(_file!.size / 1024).toStringAsFixed(1)} KB'),
            ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _mode,
            decoration: const InputDecoration(labelText: 'Import mode'),
            items: const [
              DropdownMenuItem(
                value: 'VALIDATE_ONLY',
                child: Text('Validate only'),
              ),
              DropdownMenuItem(
                value: 'CREATE_ONLY',
                child: Text('Create new accounts only'),
              ),
              DropdownMenuItem(
                value: 'CREATE_AND_UPDATE',
                child: Text('Create and update'),
              ),
              DropdownMenuItem(
                value: 'UPDATE_ONLY',
                child: Text('Update existing names and scope'),
              ),
            ],
            onChanged: (value) => setState(() {
              _mode = value!;
              _preview = null;
            }),
          ),
          const SizedBox(height: 12),
          if (['STUDENTS', 'STAFF', 'USERS'].contains(_entityType)) ...[
            DropdownButtonFormField<String>(
              initialValue: _studyYear,
              decoration: const InputDecoration(labelText: 'Study year'),
              items: const [
                DropdownMenuItem(
                  value: '',
                  child: Text('Detect from filename'),
                ),
                DropdownMenuItem(value: '2', child: Text('Second Year')),
                DropdownMenuItem(value: '3', child: Text('Third Year')),
              ],
              onChanged: (value) => setState(() {
                _studyYear = value!;
                _preview = null;
              }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _duplicateResolution,
              decoration:
                  const InputDecoration(labelText: 'Duplicate identity handling'),
              items: const [
                DropdownMenuItem(
                  value: 'KEEP_FIRST',
                  child: Text('Keep first valid row'),
                ),
                DropdownMenuItem(
                  value: 'SKIP_ALL',
                  child: Text('Skip every duplicate row'),
                ),
              ],
              onChanged: (value) =>
                  setState(() => _duplicateResolution = value!),
            ),
          ],
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _busy || _file == null ? null : _validate,
            icon: const Icon(Icons.fact_check_outlined),
            label: Text(_busy ? 'Validating' : 'Validate and preview'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          if (_preview != null) ...[
            const SizedBox(height: 22),
            Text(
              '${previewJob?['validRows'] ?? 0} valid · ${previewJob?['errorRows'] ?? 0} invalid · ${_preview?['passwordWarnings'] ?? 0} numeric password checks',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (duplicates.isNotEmpty)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.warning_amber),
                title: Text('${duplicates.length} duplicate email group'),
                subtitle: const Text('Review the listed sheet and row locations'),
              ),
            const SizedBox(height: 10),
            ...inspections.whereType<Map<String, dynamic>>().map(
                  (sheet) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: DropdownButtonFormField<String>(
                      initialValue: _departmentMappings[
                          sheet['sourceDepartmentCode'] as String?],
                      decoration: InputDecoration(
                        labelText:
                            '${sheet['sheetName']} · header row ${sheet['headerRowNumber'] ?? '-'} · ${sheet['rowCount']} users',
                      ),
                      items: departments
                          .whereType<Map<String, dynamic>>()
                          .map(
                            (department) => DropdownMenuItem(
                              value: department['code'] as String,
                              child: Text(
                                '${department['code']} - ${department['name']}',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (value) => setState(() {
                        final source =
                            sheet['sourceDepartmentCode'] as String;
                        if (value == null) {
                          _departmentMappings.remove(source);
                        } else {
                          _departmentMappings[source] = value;
                        }
                      }),
                    ),
                  ),
                ),
            if (inspections.isNotEmpty)
              OutlinedButton.icon(
                onPressed: _busy ? null : _validate,
                icon: const Icon(Icons.refresh),
                label: const Text('Apply mappings'),
              ),
            if (errors.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Validation issues',
                  style: Theme.of(context).textTheme.titleMedium),
              ...errors.take(20).whereType<Map<String, dynamic>>().map(
                    (error) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.error_outline),
                      title: Text(
                        'Row ${error['rowNumber']}${error['field'] == null ? '' : ' · ${error['field']}'}',
                      ),
                      subtitle: Text(error['message'] as String? ?? ''),
                    ),
                  ),
            ],
            if (_mode != 'VALIDATE_ONLY') ...[
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed:
                    _busy || (previewJob?['validRows'] as int? ?? 0) == 0
                        ? null
                        : _confirm,
                icon: const Icon(Icons.cloud_upload_outlined),
                label: Text(
                  'Confirm ${previewJob?['validRows'] ?? 0} valid rows',
                ),
              ),
            ],
          ],
          if (_job != null) ...[
            const SizedBox(height: 20),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.sync),
              title: Text(_job!['status'] as String? ?? 'Processing'),
              subtitle: Text(
                '${_job!['validRows'] ?? 0}/${_job!['totalRows'] ?? 0} completed · ${_job!['errorRows'] ?? 0} errors',
              ),
            ),
          ],
        ],
      ),
    );
  }
}
