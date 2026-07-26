import 'package:file_picker/file_picker.dart';
import 'package:file_saver/file_saver.dart';
import 'package:flutter/material.dart';

import '../../core/network/avs_api_client.dart';

class AttendanceExcelScreen extends StatefulWidget {
  const AttendanceExcelScreen({super.key, required this.client});

  final AvsApiClient client;

  @override
  State<AttendanceExcelScreen> createState() => _AttendanceExcelScreenState();
}

class _AttendanceExcelScreenState extends State<AttendanceExcelScreen> {
  List<Map<String, dynamic>> _departments = [];
  List<Map<String, dynamic>> _programmes = [];
  List<Map<String, dynamic>> _years = [];
  List<Map<String, dynamic>> _semesters = [];
  List<Map<String, dynamic>> _sections = [];
  List<Map<String, dynamic>> _subjects = [];
  String? _departmentId;
  String? _programmeId;
  String? _yearId;
  String? _semesterId;
  String? _sectionId;
  String? _subjectId;
  String _from = DateTime.now()
      .subtract(const Duration(days: 30))
      .toIso8601String()
      .substring(0, 10);
  String _to = DateTime.now().toIso8601String().substring(0, 10);
  String _importMode = 'VALIDATE_ONLY';
  String _attendanceMode = 'WORKING_AND_PRESENT';
  bool _loading = true;
  bool _working = false;
  Object? _error;
  Map<String, dynamic>? _batch;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<List<Map<String, dynamic>>> _list(String path) async {
    final value = await widget.client.get(path);
    return (value as List)
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  Future<void> _bootstrap() async {
    try {
      final values = await Future.wait([
        _list('/academic/departments'),
        _list('/academic/years'),
      ]);
      _departments = values[0];
      _years = values[1];
    } catch (error) {
      _error = error;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _department(String? value) async {
    setState(() {
      _departmentId = value;
      _programmeId = _semesterId = _sectionId = _subjectId = null;
      _programmes = _semesters = _sections = _subjects = [];
    });
    if (value == null) return;
    _programmes = await _list('/academic/programmes?departmentId=$value');
    setState(() {});
  }

  Future<void> _semesterOptions() async {
    if (_programmeId == null || _yearId == null) return;
    _semesters = await _list(
        '/academic/semesters?programmeId=$_programmeId&academicYearId=$_yearId');
    setState(() {});
  }

  Future<void> _semester(String? value) async {
    setState(() {
      _semesterId = value;
      _sectionId = _subjectId = null;
      _sections = _subjects = [];
    });
    if (value == null) return;
    final values = await Future.wait([
      _list('/academic/sections?semesterId=$value'),
      _list('/academic/subjects?semesterId=$value'),
    ]);
    _sections = values[0];
    _subjects = values[1];
    setState(() {});
  }

  Future<void> _download() async {
    if (_sectionId == null) {
      _message('Select a section first.');
      return;
    }
    await _run(() async {
      final query = {
        'sectionId': _sectionId!,
        'subjectId': ?_subjectId,
        'dateFrom': _from,
        'dateTo': _to,
      };
      final download = await widget.client.getBytes(
        '/attendance/templates/class?${query.entries.map((entry) => '${entry.key}=${entry.value}').join('&')}',
      );
      await FileSaver.instance.saveFile(
        name: (download.fileName ?? 'avs-attendance-template.xlsx')
            .replaceAll('.xlsx', ''),
        bytes: download.bytes,
        fileExtension: 'xlsx',
        mimeType: MimeType.custom,
        customMimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      _message('Attendance template downloaded.');
    });
  }

  Future<void> _upload() async {
    if (_sectionId == null) {
      _message('Select the section used for this workbook.');
      return;
    }
    final selected = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['xlsx', 'xls'],
      withData: true,
    );
    final file = selected?.files.single;
    if (file?.bytes == null) return;
    await _run(() async {
      final value = await widget.client.postFile(
        '/attendance/import/validate',
        fields: {
          'sectionId': _sectionId!,
          'subjectId': ?_subjectId,
          'dateFrom': _from,
          'dateTo': _to,
          'importMode': _importMode,
          'attendanceMode': _attendanceMode,
        },
        fileName: file!.name,
        bytes: file.bytes!,
      );
      _batch = Map<String, dynamic>.from(value as Map);
    });
  }

  Future<void> _confirm() async {
    final batch = _batch;
    if (batch == null || batch['status'] != 'READY') return;
    await _run(() async {
      final value = await widget.client.post('/attendance/import/confirm', {
        'batchId': batch['id'],
      });
      _batch = Map<String, dynamic>.from(value as Map);
      _message('Attendance import completed.');
    });
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await task();
    } catch (error) {
      _error = error;
      _message('$error');
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  void _message(String value) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  DropdownButtonFormField<String> _select({
    required String label,
    required String? value,
    required List<Map<String, dynamic>> values,
    required ValueChanged<String?> onChanged,
    bool optional = false,
  }) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: [
        if (optional)
          const DropdownMenuItem(value: null, child: Text('Overall attendance')),
        ...values.map(
          (row) => DropdownMenuItem(
            value: row['id'].toString(),
            child: Text('${row['name']} (${row['code'] ?? row['number'] ?? ''})'),
          ),
        ),
      ],
      onChanged: onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _departments.isEmpty) {
      return Center(
        child: FilledButton(
            onPressed: _bootstrap, child: Text('Retry attendance setup\n$_error')),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Attendance Excel Import and Export',
            style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        const Text(
            'Select the class and date range, download the protected roster, fill only attendance fields, then validate and confirm the completed workbook.'),
        const SizedBox(height: 18),
        LayoutBuilder(
          builder: (context, constraints) => GridView.count(
            crossAxisCount: constraints.maxWidth > 850 ? 3 : 1,
            childAspectRatio: constraints.maxWidth > 850 ? 4.2 : 5.2,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              _select(
                  label: 'Department',
                  value: _departmentId,
                  values: _departments,
                  onChanged: _department),
              _select(
                label: 'Programme',
                value: _programmeId,
                values: _programmes,
                onChanged: (value) {
                  setState(() => _programmeId = value);
                  _semesterOptions();
                },
              ),
              _select(
                label: 'Academic year',
                value: _yearId,
                values: _years,
                onChanged: (value) {
                  setState(() => _yearId = value);
                  _semesterOptions();
                },
              ),
              _select(
                  label: 'Semester',
                  value: _semesterId,
                  values: _semesters,
                  onChanged: _semester),
              _select(
                label: 'Section',
                value: _sectionId,
                values: _sections,
                onChanged: (value) => setState(() => _sectionId = value),
              ),
              _select(
                label: 'Subject',
                value: _subjectId,
                values: _subjects,
                optional: true,
                onChanged: (value) => setState(() => _subjectId = value),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            SizedBox(
              width: 190,
              child: TextFormField(
                initialValue: _from,
                decoration: const InputDecoration(labelText: 'From (YYYY-MM-DD)'),
                onChanged: (value) => _from = value,
              ),
            ),
            SizedBox(
              width: 190,
              child: TextFormField(
                initialValue: _to,
                decoration: const InputDecoration(labelText: 'To (YYYY-MM-DD)'),
                onChanged: (value) => _to = value,
              ),
            ),
            SizedBox(
              width: 260,
              child: DropdownButtonFormField<String>(
                initialValue: _attendanceMode,
                decoration: const InputDecoration(labelText: 'Attendance mode'),
                items: const [
                  'OVERALL_PERCENTAGE',
                  'SUBJECT_PERCENTAGE',
                  'MONTHLY_SUMMARY',
                  'WORKING_AND_PRESENT',
                  'PERIOD_WISE',
                ]
                    .map((value) => DropdownMenuItem(
                        value: value,
                        child: Text(value.replaceAll('_', ' '))))
                    .toList(),
                onChanged: (value) =>
                    setState(() => _attendanceMode = value ?? _attendanceMode),
              ),
            ),
            SizedBox(
              width: 250,
              child: DropdownButtonFormField<String>(
                initialValue: _importMode,
                decoration: const InputDecoration(labelText: 'Import mode'),
                items: const [
                  'VALIDATE_ONLY',
                  'CREATE_MISSING_SUMMARY',
                  'UPDATE_EXISTING_SUMMARY',
                  'CREATE_AND_UPDATE',
                ]
                    .map((value) => DropdownMenuItem(
                        value: value,
                        child: Text(value.replaceAll('_', ' '))))
                    .toList(),
                onChanged: (value) =>
                    setState(() => _importMode = value ?? _importMode),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 10,
          children: [
            FilledButton.icon(
              onPressed: _working ? null : _download,
              icon: const Icon(Icons.download),
              label: const Text('Download class template'),
            ),
            OutlinedButton.icon(
              onPressed: _working ? null : _upload,
              icon: const Icon(Icons.upload_file),
              label: const Text('Upload and validate'),
            ),
            if (_working) const CircularProgressIndicator(),
          ],
        ),
        if (_batch != null) ...[
          const Divider(height: 32),
          Text('Validation preview',
              style: Theme.of(context).textTheme.titleLarge),
          Text(
              'Status: ${_batch!['status']} • Valid: ${_batch!['validRows']} • Errors: ${_batch!['errorRows']}'),
          if ((_batch!['errors'] as List? ?? []).isNotEmpty)
            ...(_batch!['errors'] as List).take(20).map(
                  (error) => ListTile(
                    leading: const Icon(Icons.error_outline, color: Colors.red),
                    title: Text('${(error as Map)['message']}'),
                    subtitle: Text('Row ${error['rowNumber']}'),
                  ),
                ),
          if ((_batch!['warnings'] as List? ?? []).isNotEmpty)
            ...(_batch!['warnings'] as List).take(20).map(
                  (warning) => ListTile(
                    leading: const Icon(Icons.warning_amber),
                    title: Text('${(warning as Map)['message']}'),
                    subtitle: Text('Row ${warning['rowNumber']}'),
                  ),
                ),
          if ((_batch!['preview'] as List? ?? []).isNotEmpty)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columns: const [
                  DataColumn(label: Text('Student ID')),
                  DataColumn(label: Text('Working')),
                  DataColumn(label: Text('Present')),
                  DataColumn(label: Text('Absent')),
                  DataColumn(label: Text('%')),
                ],
                rows: (_batch!['preview'] as List)
                    .take(50)
                    .whereType<Map>()
                    .map((row) => DataRow(cells: [
                          DataCell(Text('${row['studentPublicId']}')),
                          DataCell(Text('${row['totalWorking']}')),
                          DataCell(Text('${row['present']}')),
                          DataCell(Text('${row['absent']}')),
                          DataCell(Text('${row['percentage']}')),
                        ]))
                    .toList(),
              ),
            ),
          if (_batch!['status'] == 'READY' &&
              _batch!['importMode'] != 'VALIDATE_ONLY')
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: FilledButton.icon(
                onPressed: _working ? null : _confirm,
                icon: const Icon(Icons.check),
                label: const Text('Confirm attendance import'),
              ),
            ),
          if (_batch!['status'] == 'COMPLETED')
            const ListTile(
              leading: Icon(Icons.check_circle, color: Colors.green),
              title: Text('Attendance database update completed.'),
              subtitle:
                  Text('Submitted period attendance and old history were preserved.'),
            ),
        ],
      ],
    );
  }
}
