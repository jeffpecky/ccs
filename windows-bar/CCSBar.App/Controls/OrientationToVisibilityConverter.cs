using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace CCSBar.App.Controls;

/// <summary>
/// Converts ScrollBar Orientation to Visibility for template selection.
/// Returns Visible when orientation matches the parameter, Collapsed otherwise.
/// </summary>
public sealed class OrientationToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is Orientation orientation && parameter is string paramStr)
        {
            return Enum.TryParse<Orientation>(paramStr, out var target)
                && orientation == target
                ? Visibility.Visible
                : Visibility.Collapsed;
        }
        return Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotSupportedException();
}